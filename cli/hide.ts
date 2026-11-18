// Owner commands for hiding: `memory` lists what a memory holds, numbered; `hide` and `show` act on
// a whole memory or on one numbered item. A hidden thing is treated as if it was never sent: its
// message is flagged, a hidden photo's row and files are removed, and the memory is left as an import
// would leave it (see `refresh`). What lasts is the table `hidden`, which the import reads; see
// supabase/migrations/20261118020000_hiding.sql. The numbers are printed to the owner's terminal
// only: the position in the memory's conversation at the time of listing, hidden lines included.
import { adminClient, type Db } from './supabase.ts'
import { chunks } from './import/regroup.ts'

const USAGE = [
  "Usage: pnpm ezeli memory <address>             list the memory's photos and messages, numbered",
  '       pnpm ezeli hide <address> [number]      hide one item, or the whole memory without a number',
  '       pnpm ezeli show <address> [number]      show it again (a hidden photo returns with the next import)',
  "The address is the memory's address in the app (https://.../m/<key>, /m/<key> or just <key>).",
  'Do not hide or show while an import runs.',
].join('\n')

type Item = { n: number; id: string; key: string; kind: string | null; by: string; slug: string | null; at: string; text: string; hidden: boolean }
type Found = { memory: { id: string; key: string; at: string; chat_id: string }; chat: { key: string; name: string; timezone: string }; items: Item[] }
class Plain extends Error {}

// The memory's lasting key out of what an owner copied from the app.
export function keyOf(address: string): string {
  const last = address.trim().split(/[?#]/)[0]!.replace(/\/+$/, '').split('/').pop() ?? ''
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

// One plain line for a missing setting or a failed request, never a stack trace.
async function plain(work: () => Promise<number>): Promise<number> {
  try {
    return await work()
  } catch (error) {
    const message = (error as { message?: string }).message ?? String(error)
    console.error(error instanceof Plain ? message : message.replace(/\s+/g, ' '))
    return 1
  }
}

async function find(db: Db, address: string): Promise<Found> {
  const key = keyOf(address)
  if (!key) throw new Plain(USAGE)
  const columns = 'id, key, at, chat_id, chats(key, name, timezone)'
  let memory = await db.from('memories').select(columns).eq('key', key).maybeSingle()
  if (memory.error) throw memory.error
  if (!memory.data) {
    // The address of a memory moves when its first photo is hidden: the old one still finds it here.
    const message = await db.from('messages').select('memory_id').eq('key', key).maybeSingle()
    if (message.error) throw message.error
    if (message.data) memory = await db.from('memories').select(columns).eq('id', message.data.memory_id).maybeSingle()
    if (memory.error) throw memory.error
  }
  if (!memory.data) throw new Plain('No memory has that address.')
  const messages = await db.from('messages').select('id, key, at, seq, text, media_kind, hidden, people(display_name, slug)').eq('memory_id', memory.data.id).order('at').order('seq').order('key')
  if (messages.error) throw messages.error
  const items = messages.data.map((m, index) => {
    const person = m.people as unknown as { display_name: string; slug: string | null }
    return { n: index + 1, id: m.id, key: m.key, kind: m.media_kind, by: person.display_name, slug: person.slug, at: m.at, text: m.text, hidden: m.hidden }
  })
  return { memory: memory.data, chat: memory.data.chats as unknown as Found['chat'], items }
}

function line(item: Item, zone: string) {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(item.at))
  const what = item.kind === 'photo' ? '[Photo]' : item.kind ? `[${item.kind}]` : item.text.replace(/\s+/g, ' ').slice(0, 80)
  return `${String(item.n).padStart(3)}  ${time}  ${item.by}: ${what}${item.hidden ? '   (hidden)' : ''}`
}

async function target(args: string[]) {
  const [address, number, ...rest] = args
  if (!address || rest.length > 0 || (number !== undefined && !/^[1-9]\d*$/.test(number))) throw new Plain(USAGE)
  const db = adminClient()
  const found = await find(db, address)
  const chosen = number === undefined ? found.items : found.items.filter((item) => item.n === Number(number))
  if (chosen.length === 0) throw new Plain(`The memory has no item number ${number}. List it with: pnpm ezeli memory <address>`)
  return { db, found, chosen, whole: number === undefined }
}

export const runList = (args: string[]) =>
  plain(async () => {
    if (args.length !== 1) throw new Plain(USAGE)
    const found = await find(adminClient(), args[0]!)
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: found.chat.timezone, dateStyle: 'full' }).format(new Date(found.memory.at))
    console.log(`${date} (${found.chat.name})`)
    for (const item of found.items) console.log(line(item, found.chat.timezone))
    return 0
  })

// Removes the files and then the rows of these photo messages, whatever kind the message has now
// (Android's "media omitted" can sit on a photo that was stored from an iPhone export). Files go
// first: a row left behind can be finished by running the command again. Checks the bucket after.
// Returns the number of files removed, or throws a plain line.
async function removePhotos(db: Db, chatId: string, keys: string[]): Promise<number> {
  let files = 0
  for (const part of chunks(keys)) {
    const rows = await db.from('photos').select('view_path, thumb_path').in('key', part)
    if (rows.error) throw rows.error
    // The files are named after the message key, so they are found even when no row points at them.
    const paths = [...new Set([...rows.data.flatMap((row) => [row.view_path, row.thumb_path]), ...part.flatMap((key) => [`${chatId}/${key}-view.webp`, `${chatId}/${key}-thumb.webp`])])]
    const removed = await db.storage.from('photos').remove(paths)
    if (removed.error) throw new Plain(`Hidden, but the photo files could not be removed (${removed.error.message}). Run the same command again; it finishes the job.`)
    files += removed.data.length
    for (const photo of part) {
      const left = await db.storage.from('photos').list(chatId, { search: photo })
      if (left.error || left.data.some((file) => file.name.startsWith(photo))) {
        throw new Plain('Hidden, but some photo files are still in the store. Run the same command again; it finishes the job.')
      }
    }
    const deleted = await db.from('photos').delete().in('key', part)
    if (deleted.error) throw deleted.error
  }
  return files
}

// Leaves a memory as an import would. A message is hidden when its key is marked, or when every photo
// message of its memory is marked (then the memory is hidden as well, and is on no screen). The
// visible messages are numbered without gaps, and the memory's address and date are those of its
// first photo message that is not hidden. Comments point at the memory by id, so they stay with it
// when its address moves. Returns the new address if it moved.
async function refresh(db: Db, memoryId: string): Promise<string | undefined> {
  const messages = await db.from('messages').select('id, key, at, seq, media_kind, hidden').eq('memory_id', memoryId).order('at').order('seq').order('key')
  if (messages.error) throw messages.error
  const marked = new Set<string>()
  for (const part of chunks(messages.data.map((message) => message.key))) {
    const found = await db.from('hidden').select('key').in('key', part)
    if (found.error) throw found.error
    for (const row of found.data) marked.add(row.key)
  }
  const empty = !messages.data.some((message) => message.media_kind === 'photo' && !marked.has(message.key))
  const hides = (message: { key: string }) => empty || marked.has(message.key)
  for (const message of messages.data.filter((candidate) => candidate.hidden !== hides(candidate))) {
    const flagged = await db.from('messages').update({ hidden: hides(message) }).eq('id', message.id)
    if (flagged.error) throw flagged.error
  }
  const visible = messages.data.filter((message) => !hides(message))
  const photos = await db.from('photos').select('message_id, seq').eq('memory_id', memoryId)
  if (photos.error) throw photos.error
  const photoSeq = new Map(photos.data.map((photo) => [photo.message_id, photo.seq]))
  for (const [seq, message] of visible.entries()) {
    if (message.seq !== seq) {
      const moved = await db.from('messages').update({ seq }).eq('id', message.id)
      if (moved.error) throw moved.error
    }
    if (photoSeq.has(message.id) && photoSeq.get(message.id) !== seq) {
      const moved = await db.from('photos').update({ seq }).eq('message_id', message.id)
      if (moved.error) throw moved.error
    }
  }
  const now = await db.from('memories').select('key, at, hidden').eq('id', memoryId).single()
  if (now.error) throw now.error
  const first = visible.find((message) => message.media_kind === 'photo')
  const change: { hidden?: boolean; key?: string; at?: string } = {}
  if (now.data.hidden !== empty) change.hidden = empty
  if (first && (now.data.key !== first.key || Date.parse(now.data.at) !== Date.parse(first.at))) Object.assign(change, { key: first.key, at: first.at })
  if (Object.keys(change).length > 0) {
    const moved = await db.from('memories').update(change).eq('id', memoryId)
    if (moved.error) throw moved.error
  }
  return change.key
}

export const runHide = (args: string[]) =>
  plain(async () => {
    const { db, found, chosen, whole } = await target(args)
    // What the import must remember: the key, a photo's file hash, a text message's minute, sender and text.
    const hashes = await db.from('photos').select('key, content_hash').in('key', chosen.map((item) => item.key))
    if (hashes.error) throw hashes.error
    // Photos are found by their rows too, whatever kind the message has now ("media omitted").
    const photoKeys = chosen.filter((item) => item.kind === 'photo' || item.kind === 'media' || hashes.data.some((row) => row.key === item.key)).map((item) => item.key)
    const hashOf = new Map(hashes.data.map((row) => [row.key, row.content_hash]))
    const marks = chosen.map((item) => ({
      key: item.key,
      chat_key: found.chat.key,
      content_hash: hashOf.get(item.key) ?? null,
      ...(item.kind === null && item.text !== '' && item.slug ? { minute: new Date(Math.floor(Date.parse(item.at) / 60_000) * 60_000).toISOString(), person_slug: item.slug, text: item.text } : {}),
    }))
    for (const part of chunks(marks)) {
      const marked = await db.from('hidden').upsert(part, { onConflict: 'key', ignoreDuplicates: true })
      if (marked.error) throw marked.error
    }
    // From here nothing is readable: the messages, and the photo rows, are flagged.
    for (const part of chunks(chosen.map((item) => item.key))) {
      for (const table of ['messages', 'photos'] as const) {
        const flagged = await db.from(table).update({ hidden: true }).in('key', part)
        if (flagged.error) throw flagged.error
      }
    }
    let failure: unknown
    let files = 0
    try {
      files = await removePhotos(db, found.memory.chat_id, photoKeys)
    } catch (error) {
      failure = error
    }
    const moved = await refresh(db, found.memory.id)
    if (failure) throw failure
    const rows = hashes.data.length
    console.log(`Hidden ${whole ? 'the whole memory: ' : ''}${chosen.length} ${chosen.length === 1 ? 'item' : 'items'}; ${rows} photo ${rows === 1 ? 'row' : 'rows'} and ${files} ${files === 1 ? 'file' : 'files'} removed from the store.`)
    if (photoKeys.length > rows) console.log(`${photoKeys.length - rows} of the photos had no row (the file was never in the export), so there was nothing to remove for them.`)
    if (moved) console.log(`The memory's address is now /m/${moved}.`)
    return 0
  })

export const runShow = (args: string[]) =>
  plain(async () => {
    const { db, found, chosen } = await target(args)
    const marked = chosen.filter((item) => item.hidden)
    for (const part of chunks(marked.map((item) => item.key))) {
      const removed = await db.from('hidden').delete().in('key', part)
      if (removed.error) throw removed.error
    }
    const photos = marked.filter((item) => item.kind === 'photo' || item.kind === 'media')
    // A photo row left behind by a hide that could not remove the files must not show again.
    await removePhotos(db, found.memory.chat_id, photos.map((item) => item.key))
    const moved = await refresh(db, found.memory.id)
    console.log(`Shown again: ${marked.length} ${marked.length === 1 ? 'item' : 'items'}.`)
    if (photos.length > 0) console.log(`${photos.length} of them ${photos.length === 1 ? 'is a photo; its files were' : 'are photos; their files were'} removed when hiding, so ${photos.length === 1 ? 'it returns' : 'they return'} with the next import of the chat.`)
    if (moved) console.log(`The memory's address is now /m/${moved}.`)
    return 0
  })
