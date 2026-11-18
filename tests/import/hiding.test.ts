// Hiding, at the import seam: the real import and the real owner commands on made-up exports, then
// what a friend's own session can read (tables, view, function, bucket) and what is stored.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, test, vi } from 'vitest'
import { copyOfWeekend, ezeli, fresh, freshPeople, importChat, owner, rows, signedInAs, storedChat, type Names } from './support.ts'

// Each test runs several real commands one after the other; a slow machine needs more than 5 s.
vi.setConfig({ testTimeout: 60_000 })

type Memory = { id: string; key: string }
const LRM = '‎'

// The made-up photos of the fixtures are all the same bytes; hiding by what a photo is would then
// hide them all. Give each its own colour, as real photos have.
async function distinct(folder: string) {
  for (const [index, name] of readdirSync(folder).filter((file) => file.endsWith('.jpg')).entries()) {
    await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 30 + index * 37, g: 90, b: 140 } } }).jpeg().toFile(join(folder, name))
  }
}

// An export of our own: the lines of the chat and photos of a colour each.
async function exportOf(lines: string[], photos: Record<string, number>): Promise<string> {
  const folder = mkdtempSync(join(tmpdir(), 'ezeli-hide-'))
  writeFileSync(join(folder, '_chat.txt'), `${lines.join('\n')}\n`)
  for (const [name, red] of Object.entries(photos)) await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: red, g: 120, b: 60 } } }).jpeg().toFile(join(folder, name))
  return folder
}
const photoLine = (time: string, who: string, file: string) => `${LRM}[14.08.2023, ${time}] ${who}: ${LRM}<attached: ${file}>`
const omittedLine = (time: string, who: string) => `[14.08.2023, ${time}] ${who}: ${LRM}video omitted`
const textLine = (time: string, who: string, text: string) => `[14.08.2023, ${time}] ${who}: ${text}`

async function setup() {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  const folder = copyOfWeekend()
  await distinct(folder)
  expect(importChat(chat, { people, folder }).status).toBe(0)
  const memories = await rows<Memory>(owner.from('memories').select('id, key').eq('chat_id', (await storedChat(chat))!.id as string).order('at'))
  return { chat, people, folder, first: memories[0]!, second: memories[1]!, friend: await signedInAs(fresh('Limon')) }
}

// The number of the first line of a memory's listing that matches.
function numberOf(memory: Memory | string, matching: RegExp): number {
  const listing = ezeli(['memory', `https://ezeli.example/m/${typeof memory === 'string' ? memory : memory.key}`]).out
  const found = listing.split('\n').find((line) => matching.test(line))
  if (!found) throw new Error(`no line matches ${matching} in\n${listing}`)
  return Number(found.trim().split(/\s+/)[0])
}

const photoRows = async (memory: Memory) => rows<{ key: string; view_path: string; thumb_path: string }>(owner.from('photos').select('key, view_path, thumb_path').eq('memory_id', memory.id).order('at'))
const exists = async (path: string) => !(await owner.storage.from('photos').download(path)).error
const friendMemories = async (friend: Awaited<ReturnType<typeof signedInAs>>, chat: string) =>
  rows<{ id: string; key: string; at: string }>(friend.from('memories').select('id, key, at').eq('chat_id', (await storedChat(chat))!.id as string).order('at'))

test('hiding the first photo: unreadable, files gone, and the memory looks as if it was never sent', async () => {
  const { chat, first, friend } = await setup()
  const [hidden, kept] = await photoRows(first)

  const result = ezeli(['hide', first.key, String(numberOf(first, /\[Photo\]/))])

  expect(result.status).toBe(0)
  expect(result.out).toMatch(/Hidden 1 item; 1 photo row and 2 files removed/)
  expect(await rows(friend.from('photos').select('key').eq('key', hidden!.key))).toEqual([])
  expect(await rows(friend.from('messages').select('key').eq('key', hidden!.key))).toEqual([])
  expect(await exists(hidden!.view_path)).toBe(false)
  expect(await exists(hidden!.thumb_path)).toBe(false)
  expect((await friend.storage.from('photos').createSignedUrl(hidden!.view_path, 60)).data).toBeNull()
  // The address and the date are those of the first photo that is left; the old address is no memory.
  const [memory] = await friendMemories(friend, chat)
  expect(memory!.key).toBe(kept!.key)
  expect(memory!.key).not.toBe(first.key)
  expect(new Date(memory!.at).toISOString()).toBe(new Date((await rows<{ at: string }>(owner.from('photos').select('at').eq('key', kept!.key)))[0]!.at).toISOString())
  expect((await friend.rpc('memory_detail', { p_key: first.key })).data).toBeNull()
  expect((await friend.rpc('memory_detail', { p_key: memory!.key })).data).not.toBeNull()
  // Messages are numbered without gaps, photos too, and the counts follow.
  const seqs = (await rows<{ seq: number }>(friend.from('messages').select('seq').eq('memory_id', first.id).order('seq'))).map((m) => m.seq)
  expect(seqs).toEqual(seqs.map((_, index) => index))
  const timeline = await rows<{ photo_count: number }>(friend.from('timeline').select('photo_count').eq('id', first.id))
  expect(timeline[0]!.photo_count).toBe(1)
  // The owner still finds the memory by the old address and sees the line, marked.
  expect(ezeli(['memory', first.key]).out).toMatch(/\[Photo\]   \(hidden\)/)
})

test('a hidden photo whose message turned into "media omitted" is still removed, files and row, and an old link stops working', async () => {
  const { chat, people, first, friend } = await setup()
  const [hidden] = await photoRows(first)
  const link = (await friend.storage.from('photos').createSignedUrl(hidden!.view_path, 315360000)).data!.signedUrl
  expect((await fetch(link)).ok).toBe(true)
  // The same chat exported again without media: the photo's message is Android's "media omitted", its row stays.
  const omitted = copyOfWeekendOmitted()
  expect(importChat(chat, { people, folder: await omitted }).status).toBe(0)
  expect(ezeli(['memory', first.key]).out).toMatch(/\[media\]/)

  const result = ezeli(['hide', first.key, String(numberOf(first, /\[media\]/))])

  expect(result.status).toBe(0)
  expect(await rows(owner.from('photos').select('key').eq('key', hidden!.key))).toEqual([])
  expect(await exists(hidden!.view_path)).toBe(false)
  expect(await exists(hidden!.thumb_path)).toBe(false)
  expect((await fetch(link)).ok).toBe(false)
})

async function copyOfWeekendOmitted(): Promise<string> {
  const folder = copyOfWeekend()
  await distinct(folder)
  const chatFile = join(folder, '_chat.txt')
  const text = readFileSync(chatFile, 'utf8').replace(/‎\[14\.07\.2023, 20:58:11\] Limon L: ‎<attached: [^>]+>/, `[14.07.2023, 20:58:11] Limon L: <Media omitted>`)
  writeFileSync(chatFile, text)
  return folder
}

test('a hidden photo stays hidden when an earlier media message of the same minute is deleted from the chat', async () => {
  const chat = fresh('Gizli Ağ')
  const people = freshPeople()
  const first = await exportOf(
    [
      omittedLine('10:05:05', 'Limon L'),
      photoLine('10:05:30', 'Limon L', 'a.jpg'),
      textLine('10:06:00', 'Karpuz K', 'Güzel'),
      photoLine('10:20:00', 'Karpuz K', 'b.jpg'),
    ],
    { 'a.jpg': 200, 'b.jpg': 40 },
  )
  const firstRun = importChat(chat, { people, folder: first })
  expect(firstRun.status).toBe(0)
  const memory = (await rows<Memory>(owner.from('memories').select('id, key').eq('chat_id', (await storedChat(chat))!.id as string)))[0]!
  const friend = await signedInAs(fresh('Limon'))
  const aKey = (await rows<{ key: string; view_path: string }>(owner.from('photos').select('key, view_path').eq('memory_id', memory.id).order('at')))[0]!

  expect(ezeli(['hide', memory.key, String(numberOf(memory, /\[Photo\]/))]).status).toBe(0)

  // A newer export: the earlier media message is deleted, so the photo takes its place in the minute.
  const newer = await exportOf(
    [
      `${LRM}[14.08.2023, 10:05:05] Limon L: ${LRM}Bu mesaj silindi.`,
      photoLine('10:05:30', 'Limon L', 'a.jpg'),
      textLine('10:06:00', 'Karpuz K', 'Güzel'),
      photoLine('10:20:00', 'Karpuz K', 'b.jpg'),
    ],
    { 'a.jpg': 200, 'b.jpg': 40 },
  )
  const again = importChat(chat, { people, folder: newer })
  expect(again.status).toBe(0)

  const stored = await rows<{ key: string }>(owner.from('photos').select('key').eq('memory_id', memory.id))
  expect(stored.length).toBe(1)
  expect(stored.map((photo) => photo.key)).not.toContain(aKey.key)
  expect(await exists(aKey.view_path)).toBe(false)
  const seen = await rows<{ key: string }>(friend.from('photos').select('key').eq('memory_id', memory.id))
  expect(seen.length).toBe(1)
  const chatId = (await storedChat(chat))!.id as string
  const listing = (await rows<{ view_path: string }>(owner.from('photos').select('view_path'))).filter((photo) => photo.view_path.startsWith(`${chatId}/`))
  expect(listing.length).toBe(1)
})

test('a hidden message stays hidden when an earlier identical message of the same minute is deleted', async () => {
  const chat = fresh('Gizli Yazı')
  const people = freshPeople()
  const lines = (tamam: number) => [
    ...(tamam > 1 ? [textLine('11:00:10', 'Limon L', 'tamam')] : []),
    textLine('11:00:40', 'Limon L', 'tamam'),
    textLine('11:00:50', 'Fıstık F', 'Biz de geliyoruz'),
    photoLine('11:01:00', 'Karpuz K', 'a.jpg'),
  ]
  expect(importChat(chat, { people, folder: await exportOf(lines(2), { 'a.jpg': 90 }) }).status).toBe(0)
  const memory = (await rows<Memory>(owner.from('memories').select('id, key').eq('chat_id', (await storedChat(chat))!.id as string)))[0]!
  const friend = await signedInAs(fresh('Limon'))
  const talk = async () => (await rows<{ text: string }>(friend.from('messages').select('text').eq('memory_id', memory.id))).filter((m) => m.text === 'tamam').length
  expect(await talk()).toBe(2)

  ezeli(['hide', memory.key, String(numberOf(memory, /tamam/) + 1)])
  expect(await talk()).toBe(1)

  // The earlier "tamam" is deleted in a newer export: the hidden one takes its key. It stays hidden.
  expect(importChat(chat, { people, folder: await exportOf(lines(1), { 'a.jpg': 90 }) }).status).toBe(0)
  expect(await talk()).toBe(0)
})

test('a hidden photo stays hidden when the same chat is imported again with other grouping numbers', async () => {
  const { chat, people, folder, first, friend } = await setup()
  const [shown] = await photoRows(first)
  ezeli(['hide', first.key, String(numberOf(first, /\[Photo\]/))])

  const again = importChat(chat, { people, folder, extra: ['--photo-gap', '5'] })
  expect(again.status).toBe(0)

  expect(await rows(owner.from('photos').select('key').in('key', [shown!.key]))).toEqual([])
  expect(await exists(shown!.view_path)).toBe(false)
  expect(await exists(shown!.thumb_path)).toBe(false)
  expect(await rows(friend.from('messages').select('key').eq('key', shown!.key))).toEqual([])
  // The hidden photo takes no part in the grouping: Karpuz's photo and the next day's photo.
  expect((await friendMemories(friend, chat)).length).toBe(2)
})

test('hiding the only photo of a memory takes the memory off the timeline and its address answers as if it were not there', async () => {
  const { chat, second, friend } = await setup()
  expect((await friendMemories(friend, chat)).length).toBe(2)

  const result = ezeli(['hide', second.key, String(numberOf(second, /\[Photo\]/))])

  expect(result.status).toBe(0)
  expect(await rows(friend.from('timeline').select('id').eq('id', second.id))).toEqual([])
  expect(await rows(friend.from('memories').select('id').eq('id', second.id))).toEqual([])
  expect(await rows(friend.from('messages').select('id').eq('memory_id', second.id))).toEqual([])
  expect((await friend.rpc('memory_detail', { p_key: second.key })).data).toBeNull()
  expect((await friend.rpc('memory_detail', { p_key: 'no-such-memory' })).data).toBeNull()
  expect(ezeli(['memory', second.key]).status).toBe(0)
})

test('hiding a whole memory hides every photo and message in it; showing it lifts the marks and the photos return with an import', async () => {
  const { chat, people, folder, first, friend } = await setup()
  const held = await rows<{ key: string }>(owner.from('messages').select('key').eq('memory_id', first.id))

  expect(ezeli(['hide', first.key]).out).toMatch(new RegExp(`Hidden the whole memory: ${held.length} items`))
  expect(await rows(friend.from('messages').select('key').eq('memory_id', first.id))).toEqual([])
  expect(await rows(friend.from('memories').select('id').eq('id', first.id))).toEqual([])
  expect(await rows(owner.from('photos').select('key').eq('memory_id', first.id))).toEqual([])
  // An import in between does not lose the hidden memory.
  expect(importChat(chat, { people, folder }).status).toBe(0)
  expect(ezeli(['memory', first.key]).status).toBe(0)

  const shown = ezeli(['show', first.key])
  expect(shown.out).toMatch(new RegExp(`Shown again: ${held.length} items`))
  expect(shown.out).toMatch(/return with the next import/)
  expect(await rows(owner.from('hidden').select('key').in('key', held.map((m) => m.key)))).toEqual([])
  expect(importChat(chat, { people, folder }).status).toBe(0)
  expect((await friendMemories(friend, chat)).length).toBe(2)
})

test('a hidden message is shown again with one command, without an import', async () => {
  const { first, friend } = await setup()
  const message = numberOf(first, /Ben geldim bile/)
  const text = () => friend.from('messages').select('key').eq('memory_id', first.id).ilike('text', '%Ben geldim bile%')

  ezeli(['hide', first.key, String(message)])
  expect(await rows(text())).toEqual([])
  expect(ezeli(['memory', first.key]).out).toMatch(/Ben geldim bile.*\(hidden\)/)

  const shown = ezeli(['show', first.key, String(message)])
  expect(shown.status).toBe(0)
  expect(shown.out).toMatch(/Shown again: 1 item/)
  expect((await rows(text())).length).toBe(1)
  const seqs = (await rows<{ seq: number }>(friend.from('messages').select('seq').eq('memory_id', first.id).order('seq'))).map((m) => m.seq)
  expect(seqs).toEqual(seqs.map((_, index) => index))
})

test('a hidden photo returns with the next import once it is shown', async () => {
  const { chat, people, folder, first, friend } = await setup()
  const [shown] = await photoRows(first)
  const photo = numberOf(first, /\[Photo\]/)
  ezeli(['hide', first.key, String(photo)])

  expect(ezeli(['show', first.key, String(photo)]).out).toMatch(/returns with the next import/)
  expect(await rows(friend.from('photos').select('key').eq('key', shown!.key))).toEqual([])

  expect(importChat(chat, { people, folder }).status).toBe(0)
  expect((await rows(friend.from('photos').select('key').eq('key', shown!.key))).length).toBe(1)
})

test('hiding in one chat leaves another chat of the same export alone', async () => {
  const folder = copyOfWeekend()
  await distinct(folder)
  const people: Names = freshPeople()
  const [one, two] = [fresh('Kaş Tatili'), fresh('Kaş Yedek')]
  expect(importChat(one, { people, folder }).status).toBe(0)
  expect(importChat(two, { people, folder }).status).toBe(0)
  const friend = await signedInAs(fresh('Limon'))
  const inOne = (await rows<Memory>(owner.from('memories').select('id, key').eq('chat_id', (await storedChat(one))!.id as string).order('at')))[0]!

  ezeli(['hide', inOne.key])

  expect((await friendMemories(friend, one)).length).toBe(1)
  expect((await friendMemories(friend, two)).length).toBe(2)
  expect(importChat(one, { people, folder }).status).toBe(0)
  expect((await friendMemories(friend, one)).length).toBe(1)
})

test('a photo flagged hidden is unreadable in the bucket even before its files are removed', async () => {
  const { first, friend } = await setup()
  const [hidden] = await photoRows(first)
  expect((await friend.storage.from('photos').createSignedUrl(hidden!.view_path, 60)).data).not.toBeNull()

  await owner.from('photos').update({ hidden: true }).eq('key', hidden!.key)

  expect((await friend.storage.from('photos').createSignedUrl(hidden!.view_path, 60)).data).toBeNull()
  expect((await friend.storage.from('photos').download(hidden!.thumb_path)).data).toBeNull()
  expect(await rows(friend.from('photos').select('key').eq('key', hidden!.key))).toEqual([])
})

test('hiding twice, or a photo that has no row, is not an error; a wrong address or number or a missing setting is one plain line', async () => {
  const { first, friend } = await setup()
  const number = String(numberOf(first, /\[Photo\]/))
  expect(ezeli(['hide', first.key, number]).status).toBe(0)

  const twice = ezeli(['hide', first.key, number])

  expect(twice.status).toBe(0)
  expect(twice.err).toBe('')
  expect(twice.out).toMatch(/Hidden 1 item; 0 photo rows and 0 files removed/)
  expect((await friend.from('hidden').select('*')).data ?? []).toEqual([])
  expect((await friend.from('hidden').insert({ key: 'x', chat_key: 'x' })).error).not.toBeNull()
  expect(ezeli(['hide', 'no-such-memory']).status).toBe(1)
  expect(ezeli(['hide', first.key, '99']).err).toMatch(/no item number 99/)
  expect(ezeli(['hide', first.key, 'one']).status).toBe(1)
  const unset = ezeli(['hide', first.key, '1'], { SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' })
  expect(unset.status).toBe(1)
  expect(unset.err.trim().split('\n')).toEqual(['Set SUPABASE_URL, SUPABASE_SECRET_KEY in the environment first.'])
})

test('comments of a memory that is hidden cannot be read or added, and stay with that memory after an import with other numbers', async () => {
  const { chat, people, folder, first, friend } = await setup()
  const added = await friend.from('comments').insert({ memory_id: first.id, body: 'Ne güzel gündü' }).select('id').single()
  expect(added.error).toBeNull()
  expect((await rows(friend.from('comments').select('id').eq('memory_id', first.id))).length).toBe(1)

  expect(ezeli(['hide', first.key]).status).toBe(0)

  expect(await rows(friend.from('comments').select('id').eq('memory_id', first.id))).toEqual([])
  expect((await friend.from('comments').insert({ memory_id: first.id, body: 'Hâlâ burada mısınız' })).error).not.toBeNull()
  // A regroup does not hand them to a memory that is shown: the hidden photos take no part in it.
  expect(importChat(chat, { people, folder, extra: ['--photo-gap', '5'] }).status).toBe(0)
  const kept = await rows<{ memory_id: string }>(owner.from('comments').select('memory_id').eq('id', added.data!.id))
  expect(kept[0]!.memory_id).toBe(first.id)
  expect(await rows(friend.from('comments').select('id').eq('id', added.data!.id))).toEqual([])
})
