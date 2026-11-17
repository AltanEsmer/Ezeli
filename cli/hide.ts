// Owner commands for hiding: `memory` lists what a memory holds, numbered; `hide` and `show` act on
// a whole memory or on one numbered item. A hidden mark hangs on the lasting key of a photo or a
// message (see supabase/migrations/20261118010000_hiding.sql). The numbers are printed to the
// owner's terminal only, and are the position in the memory's conversation at the time of listing.
import { adminClient, type Db } from './supabase.ts'
import { chunks, loadHidden } from './import/regroup.ts'

const USAGE = [
  "Usage: pnpm ezeli memory <address>             list the memory's photos and messages, numbered",
  '       pnpm ezeli hide <address> [number]      hide one item, or the whole memory without a number',
  '       pnpm ezeli show <address> [number]      show it again (a hidden photo returns with the next import)',
  "The address is the memory's address in the app (https://.../m/<key>, /m/<key> or just <key>).",
].join('\n')

type Item = { n: number; key: string; kind: string | null; by: string; at: string; text: string; hidden: boolean }
type Found = { memory: { id: string; key: string; at: string }; chat: { name: string; timezone: string }; items: Item[] }

// The memory's lasting key out of what an owner copied from the app.
export function keyOf(address: string): string {
  const last = address.trim().split(/[?#]/)[0]!.replace(/\/+$/, '').split('/').pop() ?? ''
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

async function find(db: Db, address: string): Promise<Found | string> {
  const key = keyOf(address)
  if (!key) return USAGE
  const memory = await db.from('memories').select('id, key, at, chats(name, timezone)').eq('key', key).maybeSingle()
  if (memory.error) throw memory.error
  if (!memory.data) return 'No memory has that address.'
  const messages = await db.from('messages').select('key, at, seq, text, media_kind, people(display_name)').eq('memory_id', memory.data.id).order('at').order('seq')
  if (messages.error) throw messages.error
  const hidden = await loadHidden(db)
  const chat = memory.data.chats as unknown as { name: string; timezone: string }
  const items = messages.data.map((m, index) => ({
    n: index + 1,
    key: m.key,
    kind: m.media_kind,
    by: (m.people as unknown as { display_name: string }).display_name,
    at: m.at,
    text: m.text,
    hidden: hidden.has(m.key),
  }))
  return { memory: memory.data, chat, items }
}

function line(item: Item, zone: string) {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(item.at))
  const what = item.kind === 'photo' ? '[Photo]' : item.kind ? `[${item.kind}]` : item.text.replace(/\s+/g, ' ').slice(0, 80)
  return `${String(item.n).padStart(3)}  ${time}  ${item.by}: ${what}${item.hidden ? '   (hidden)' : ''}`
}

async function parse(args: string[]) {
  const [address, number, ...rest] = args
  if (!address || rest.length > 0 || (number !== undefined && !/^[1-9]\d*$/.test(number))) {
    console.error(USAGE)
    return undefined
  }
  const db = adminClient()
  const found = await find(db, address)
  if (typeof found === 'string') {
    console.error(found)
    return undefined
  }
  const chosen = number === undefined ? found.items : found.items.filter((item) => item.n === Number(number))
  if (chosen.length === 0) {
    console.error(`The memory has no item number ${number}. List it with: pnpm ezeli memory <address>`)
    return undefined
  }
  return { db, chosen, whole: number === undefined }
}

export async function runList(args: string[]): Promise<number> {
  if (args.length !== 1) return (console.error(USAGE), 1)
  const found = await find(adminClient(), args[0]!)
  if (typeof found === 'string') return (console.error(found), 1)
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: found.chat.timezone, dateStyle: 'full' }).format(new Date(found.memory.at))
  console.log(`${date} (${found.chat.name})`)
  for (const item of found.items) console.log(line(item, found.chat.timezone))
  return 0
}

export async function runHide(args: string[]): Promise<number> {
  const target = await parse(args)
  if (!target) return 1
  const { db, chosen, whole } = target
  // The mark first, so nothing is readable from this moment; then the photo's row and its files.
  for (const part of chunks(chosen.map((item) => ({ key: item.key })))) {
    const marked = await db.from('hidden').upsert(part, { onConflict: 'key', ignoreDuplicates: true })
    if (marked.error) throw marked.error
  }
  const photoKeys = chosen.filter((item) => item.kind === 'photo').map((item) => item.key)
  let files = 0
  for (const part of chunks(photoKeys)) {
    const rows = await db.from('photos').select('view_path, thumb_path').in('key', part)
    if (rows.error) throw rows.error
    const deleted = await db.from('photos').delete().in('key', part)
    if (deleted.error) throw deleted.error
    const removed = await db.storage.from('photos').remove(rows.data.flatMap((row) => [row.view_path, row.thumb_path]))
    if (removed.error) {
      console.error(`Hidden, but some photo files could not be removed (${removed.error.message}). Run the same import again; it removes files that have no row.`)
      return 1
    }
    files += rows.data.length
  }
  console.log(`Hidden ${whole ? 'the whole memory: ' : ''}${chosen.length} ${chosen.length === 1 ? 'item' : 'items'}; ${files} ${files === 1 ? 'photo' : 'photos'} removed from the store.`)
  return 0
}

export async function runShow(args: string[]): Promise<number> {
  const target = await parse(args)
  if (!target) return 1
  const { db, chosen } = target
  const marked = chosen.filter((item) => item.hidden)
  for (const part of chunks(marked.map((item) => item.key))) {
    const removed = await db.from('hidden').delete().in('key', part)
    if (removed.error) throw removed.error
  }
  const photos = marked.filter((item) => item.kind === 'photo').length
  console.log(`Shown again: ${marked.length} ${marked.length === 1 ? 'item' : 'items'}.`)
  if (photos > 0) console.log(`${photos} of them ${photos === 1 ? 'is a photo; its files were' : 'are photos; their files were'} removed when hiding, so ${photos === 1 ? 'it returns' : 'they return'} with the next import of the chat.`)
  return 0
}
