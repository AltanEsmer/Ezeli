// Owner commands for hiding (docs/hiding.md). `memory` lists what a memory holds, numbered; `hide`
// writes marks for one item or the whole memory and applies them; `hidden` lists the marks,
// numbered; `show` removes a mark. The numbers are printed to the owner's terminal only.
import { adminClient, type Db } from './supabase.ts'
import { applyMarks, kindOf, loadMarks, matched, storedThings, type Kind } from './import/marks.ts'
import { chunks } from './import/regroup.ts'
import { Stop } from './import/stop.ts'

const USAGE = [
  "Usage: pnpm ezeli memory <address>             list the memory's photos and messages, numbered",
  '       pnpm ezeli hide <address> [number]      hide one item, or the whole memory without a number',
  '       pnpm ezeli hidden                       list what is hidden, numbered',
  '       pnpm ezeli show <number>                stop hiding an item of that list (it returns with the next import)',
  "The address is the memory's address in the app (https://.../m/<key>, /m/<key> or just <key>).",
].join('\n')

type Item = { n: number; key: string; kind: string | null; by: string; slug: string; at: string; text: string }
type Found = { memory: { id: string; key: string; at: string }; chat: { id: string; key: string; name: string; timezone: string }; items: Item[] }

// The memory's lasting key out of what an owner copied from the app.
export function keyOf(address: string): string {
  const last = address.trim().split(/[?#]/)[0]!.replace(/\/+$/, '').split('/').pop() ?? ''
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

// One plain line for a failed command, never a stack trace.
async function plain(work: () => Promise<number>): Promise<number> {
  try {
    return await work()
  } catch (error) {
    console.error(((error as { message?: string }).message ?? String(error)).replace(/\s+/g, ' ').trim() || 'Something went wrong. Run the same command again.')
    return 1
  }
}

async function find(db: Db, address: string): Promise<Found> {
  const key = keyOf(address)
  if (!key) throw new Stop(USAGE)
  const memory = await db.from('memories').select('id, key, at, chats(id, key, name, timezone)').eq('key', key).maybeSingle()
  if (memory.error) throw memory.error
  if (!memory.data) throw new Stop('No memory has that address.')
  const messages = await db.from('messages').select('key, at, seq, text, media_kind, people(display_name, slug)').eq('memory_id', memory.data.id).order('at').order('seq').order('key')
  if (messages.error) throw messages.error
  const items = messages.data.map((m, index) => {
    const person = m.people as unknown as { display_name: string; slug: string }
    return { n: index + 1, key: m.key, kind: m.media_kind, by: person.display_name, slug: person.slug, at: m.at, text: m.text }
  })
  return { memory: memory.data, chat: memory.data.chats as unknown as Found['chat'], items }
}

const clock = (at: string, zone: string) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at))
const when = (at: string, zone: string) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at))
const kindName = (kind: Kind) => (kind === 'photo' ? 'photo' : kind === 'text' ? 'message' : 'other media')

export const runList = (args: string[]) =>
  plain(async () => {
    if (args.length !== 1) throw new Stop(USAGE)
    const found = await find(adminClient(), args[0]!)
    console.log(`${new Intl.DateTimeFormat('en-GB', { timeZone: found.chat.timezone, dateStyle: 'full' }).format(new Date(found.memory.at))} (${found.chat.name})`)
    for (const item of found.items) {
      const what = item.kind === 'photo' ? '[Photo]' : item.kind ? `[${item.kind}]` : item.text.replace(/\s+/g, ' ').slice(0, 80)
      console.log(`${String(item.n).padStart(3)}  ${clock(item.at, found.chat.timezone)}  ${item.by}: ${what}`)
    }
    return 0
  })

export const runHide = (args: string[]) =>
  plain(async () => {
    const [address, number, ...rest] = args
    if (!address || rest.length > 0 || (number !== undefined && !/^[1-9]\d*$/.test(number))) throw new Stop(USAGE)
    const db = adminClient()
    const found = await find(db, address)
    const chosen = number === undefined ? found.items : found.items.filter((item) => item.n === Number(number))
    if (chosen.length === 0) throw new Stop(`The memory has no item number ${number}. List it with: pnpm ezeli memory <address>`)

    // What to match: a photo's file hash ('' when it has none), a message's text, nothing for other media.
    const hashes = await db.from('photos').select('key, content_hash').in('key', chosen.map((item) => item.key))
    if (hashes.error) throw hashes.error
    const hashOf = new Map(hashes.data.map((row) => [row.key, row.content_hash ?? '']))
    const wanted = chosen.map((item) => {
      const kind = kindOf(item.kind ? { kind: item.kind } : null)
      return { key: item.key, chat_key: found.chat.key, person_slug: item.slug, minute: new Date(Math.floor(Date.parse(item.at) / 60_000) * 60_000).toISOString(), kind, match: kind === 'text' ? item.text : kind === 'photo' ? (hashOf.get(item.key) ?? '') : '' }
    })
    const have = new Set((await loadMarks(db, found.chat.key)).map((mark) => JSON.stringify([mark.person_slug, Date.parse(mark.minute), mark.kind, mark.match])))
    const fresh = new Map<string, (typeof wanted)[number]>()
    for (const mark of wanted) {
      const id = JSON.stringify([mark.person_slug, Date.parse(mark.minute), mark.kind, mark.match])
      if (!have.has(id)) fresh.set(id, mark)
    }

    // The match is exact where it can be. Where it cannot (no stored hash, other media), all of that
    // person's things of that kind in that minute go: say what else goes before it does.
    const { things } = await storedThings(db, found.chat.id)
    const { hits: going } = matched(things, [...fresh.values()], true)
    const asked = new Set(chosen.map((item) => item.key))
    const more = [...going].filter((thing) => !asked.has(thing.message.key))
    if (more.length > 0) {
      console.log(`The match is not exact, so ${more.length === 1 ? 'this goes' : 'these go'} with it:`)
      for (const thing of more) console.log(`  ${when(thing.message.at, found.chat.timezone)}  ${thing.message.people.display_name}: ${kindName(thing.kind)}`)
    }

    for (const part of chunks([...fresh.values()].map(({ key: _key, ...mark }) => mark))) {
      const written = await db.from('hidden').insert(part)
      if (written.error) throw written.error
    }
    const done = await applyMarks(db, found.chat.key)
    console.log(`Hidden: ${done.messages} ${done.messages === 1 ? 'message' : 'messages'} (${done.photos} ${done.photos === 1 ? 'photo' : 'photos'} with their files); ${done.memories} ${done.memories === 1 ? 'memory' : 'memories'} and ${done.comments} ${done.comments === 1 ? 'comment' : 'comments'} removed with them.`)
    const now = await db.from('memories').select('key').eq('id', found.memory.id).maybeSingle()
    if (now.data && now.data.key !== found.memory.key) console.log(`The memory's address is now /m/${now.data.key}.`)
    return 0
  })

export const runHidden = (args: string[]) =>
  plain(async () => {
    if (args.length !== 0) throw new Stop(USAGE)
    const marks = await listMarks(adminClient())
    if (marks.length === 0) console.log('Nothing is hidden.')
    let chat = ''
    for (const [index, mark] of marks.entries()) {
      if (mark.chatName !== chat) console.log(`${(chat = mark.chatName)}`)
      console.log(`${String(index + 1).padStart(3)}  ${when(mark.minute, mark.timezone)}  ${mark.by}: ${kindName(mark.kind)}`)
    }
    return 0
  })

async function listMarks(db: Db) {
  const marks = await db.from('hidden').select('id, chat_key, person_slug, minute, kind').order('chat_key').order('hidden_at').order('id')
  if (marks.error) throw marks.error
  const chats = await db.from('chats').select('key, name, timezone')
  if (chats.error) throw chats.error
  const people = await db.from('people').select('slug, display_name')
  if (people.error) throw people.error
  return marks.data.map((mark) => {
    const chat = chats.data.find((candidate) => candidate.key === mark.chat_key)
    return { id: mark.id, minute: mark.minute, kind: mark.kind as Kind, chatName: chat?.name ?? mark.chat_key, timezone: chat?.timezone ?? 'UTC', by: people.data.find((p) => p.slug === mark.person_slug)?.display_name ?? mark.person_slug }
  })
}

export const runShow = (args: string[]) =>
  plain(async () => {
    const [number, ...rest] = args
    if (!number || rest.length > 0 || !/^[1-9]\d*$/.test(number)) throw new Stop(USAGE)
    const db = adminClient()
    const mark = (await listMarks(db))[Number(number) - 1]
    if (!mark) throw new Stop(`Nothing hidden has number ${number}. List it with: pnpm ezeli hidden`)
    const removed = await db.from('hidden').delete().eq('id', mark.id)
    if (removed.error) throw removed.error
    console.log(`No longer hidden: ${kindName(mark.kind)} by ${mark.by}, ${when(mark.minute, mark.timezone)} (${mark.chatName}). It returns with the next import of that chat.`)
    return 0
  })
