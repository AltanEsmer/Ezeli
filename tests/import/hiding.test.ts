// Hiding, at the import seam: the real import and the real owner commands on made-up exports, then
// what a friend's own session can read (tables, view, function, bucket) and what is stored. A hidden
// thing is gone: the marks decide what an import leaves out and what the owner command removes.
import { spawn } from 'node:child_process'
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, test } from 'vitest'
import { copyOfWeekend, ezeli, ezeliImport, fresh, freshPeople, importChat, owner, peopleFile, rows, signedInAs, stack, storedChat, type Names } from './support.ts'

type Memory = { id: string; key: string }
type Friend = Awaited<ReturnType<typeof signedInAs>>
const LRM = '‎'

// The made-up photos of the fixtures are all the same bytes, and a hidden photo is found by its
// bytes. Give each its own colour, as real photos have.
async function distinct(folder: string) {
  for (const [index, name] of readdirSync(folder).filter((file) => file.endsWith('.jpg')).entries()) {
    await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 30 + index * 37, g: 90, b: 140 } } }).jpeg().toFile(join(folder, name))
  }
}

// An export of our own: the lines of the chat and photos of a colour each (the colour is the bytes).
async function exportOf(lines: string[], photos: Record<string, number>): Promise<string> {
  const folder = mkdtempSync(join(tmpdir(), 'ezeli-hide-'))
  writeFileSync(join(folder, '_chat.txt'), `${lines.join('\n')}\n`)
  for (const [name, red] of Object.entries(photos)) await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: red, g: 120, b: 60 } } }).jpeg().toFile(join(folder, name))
  return folder
}
const photoLine = (time: string, who: string, file: string) => `${LRM}[14.08.2023, ${time}] ${who}: ${LRM}<attached: ${file}>`
const videoLine = (time: string, who: string) => `[14.08.2023, ${time}] ${who}: ${LRM}video omitted`
const deletedLine = (time: string, who: string) => `${LRM}[14.08.2023, ${time}] ${who}: ${LRM}Bu mesaj silindi.`
const textLine = (time: string, who: string, text: string) => `[14.08.2023, ${time}] ${who}: ${text}`

async function setup() {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  const folder = copyOfWeekend()
  await distinct(folder)
  expect(importChat(chat, { people, folder }).status).toBe(0)
  const chatId = (await storedChat(chat))!.id as string
  const memories = await rows<Memory>(owner.from('memories').select('id, key').eq('chat_id', chatId).order('at'))
  return { chat, chatId, people, folder, first: memories[0]!, second: memories[1]!, friend: await signedInAs(fresh('Limon')) }
}

// An import of our own chat, then its memory and a friend.
async function ownChat(lines: string[], photos: Record<string, number>) {
  const chat = fresh('Gizli Ağ')
  const people = freshPeople()
  const result = importChat(chat, { people, folder: await exportOf(lines, photos) })
  expect(result.status, result.err).toBe(0)
  const chatId = (await storedChat(chat))!.id as string
  const memories = await rows<Memory>(owner.from('memories').select('id, key').eq('chat_id', chatId).order('at'))
  return { chat, chatId, people, memories, first: memories[0]!, friend: await signedInAs(fresh('Limon')) }
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
const chatFiles = async (chatId: string) => ((await owner.storage.from('photos').list(chatId, { limit: 1000 })).data ?? []).map((file) => file.name)
const friendMemories = async (friend: Friend, chat: string) =>
  rows<{ id: string; key: string; at: string }>(friend.from('memories').select('id, key, at').eq('chat_id', (await storedChat(chat))!.id as string).order('at'))
const friendPhotos = async (friend: Friend, chatId: string) =>
  rows<{ key: string }>(friend.from('photos').select('key, memories!inner(chat_id)').eq('memories.chat_id', chatId))
const photoMemories = async (chatId: string) =>
  rows<{ key: string }>(owner.from('photos').select('key, memories!inner(chat_id)').eq('memories.chat_id', chatId))

test('hiding the first photo: it is gone, its files and old links too, and the memory looks as if it was never sent', async () => {
  const { chat, first, friend } = await setup()
  const [hidden, kept] = await photoRows(first)
  const link = (await friend.storage.from('photos').createSignedUrl(hidden!.view_path, 315360000)).data!.signedUrl
  expect((await fetch(link)).ok).toBe(true)

  const result = ezeli(['hide', first.key, String(numberOf(first, /\[Photo\]/))])

  expect(result.status).toBe(0)
  expect(result.out).toMatch(/Hidden: 1 message \(1 photo with their files\); 0 memories and 0 comments removed/)
  expect(await rows(owner.from('photos').select('key').eq('key', hidden!.key))).toEqual([])
  expect(await rows(owner.from('messages').select('key').eq('key', hidden!.key))).toEqual([])
  expect(await exists(hidden!.view_path)).toBe(false)
  expect(await exists(hidden!.thumb_path)).toBe(false)
  expect((await fetch(link)).ok).toBe(false)
  // The address and the date are those of the first photo that is left; the old address is no memory.
  const [memory] = await friendMemories(friend, chat)
  expect(memory!.key).toBe(kept!.key)
  expect(new Date(memory!.at).getTime()).toBe(new Date((await rows<{ at: string }>(owner.from('photos').select('at').eq('key', kept!.key)))[0]!.at).getTime())
  expect((await friend.rpc('memory_detail', { p_key: first.key })).data).toBeNull()
  expect((await friend.rpc('memory_detail', { p_key: memory!.key })).data).not.toBeNull()
  // Messages are numbered without gaps; the counts follow.
  const seqs = (await rows<{ seq: number }>(friend.from('messages').select('seq').eq('memory_id', first.id).order('seq'))).map((m) => m.seq)
  expect(seqs).toEqual(seqs.map((_, index) => index))
  expect((await rows<{ photo_count: number }>(friend.from('timeline').select('photo_count').eq('id', first.id)))[0]!.photo_count).toBe(1)
})

test('a photo whose message turned into "media omitted" is still removed, files and row, and an old link stops working', async () => {
  const { chat, people, first, friend } = await ownChat([photoLine('10:05:30', 'Limon L', 'a.jpg'), textLine('10:06:00', 'Karpuz K', 'Güzel'), photoLine('10:20:00', 'Karpuz K', 'b.jpg')], { 'a.jpg': 200, 'b.jpg': 40 })
  const [hidden] = await photoRows(first)
  const link = (await friend.storage.from('photos').createSignedUrl(hidden!.view_path, 315360000)).data!.signedUrl
  // The same chat exported again without media: the photo's message is Android's "media omitted", its row stays.
  const without = [textLine('10:05:30', 'Limon L', '<Media omitted>'), textLine('10:06:00', 'Karpuz K', 'Güzel'), photoLine('10:20:00', 'Karpuz K', 'b.jpg')]
  expect(importChat(chat, { people, folder: await exportOf(without, { 'b.jpg': 40 }) }).status).toBe(0)
  // The photo's message is no photo now, so its memory is known by its next photo: find it by the message.
  const holder = (await rows<{ memory_id: string }>(owner.from('messages').select('memory_id').eq('key', hidden!.key)))[0]!.memory_id
  const address = (await rows<{ key: string }>(owner.from('memories').select('key').eq('id', holder)))[0]!.key
  expect(ezeli(['memory', address]).out).toMatch(/\[media\]/)

  expect(ezeli(['hide', address, String(numberOf(address, /\[media\]/))]).status).toBe(0)

  expect(await rows(owner.from('photos').select('key').eq('key', hidden!.key))).toEqual([])
  expect(await exists(hidden!.view_path)).toBe(false)
  expect(await exists(hidden!.thumb_path)).toBe(false)
  expect((await fetch(link)).ok).toBe(false)
})

// Limon sends a video at 10:05:05 and photo a at 10:05:30; Karpuz sends photo b at 10:20. The video
// is later deleted by its sender, so a takes its place in the minute and gets its key.
const base = (extra: string[] = []) => [videoLine('10:05:05', 'Limon L'), photoLine('10:05:30', 'Limon L', 'a.jpg'), ...extra, textLine('10:06:00', 'Karpuz K', 'Güzel'), photoLine('10:20:00', 'Karpuz K', 'b.jpg')]
const afterDeleting = (extra: string[] = []) => [deletedLine('10:05:05', 'Limon L'), photoLine('10:05:30', 'Limon L', 'a.jpg'), ...extra, textLine('10:06:00', 'Karpuz K', 'Güzel'), photoLine('10:20:00', 'Karpuz K', 'b.jpg')]

test('a hidden photo stays hidden when an earlier message of its minute is deleted, even when the file has other bytes', async () => {
  const { chat, chatId, people, first, friend } = await ownChat(base(), { 'a.jpg': 200, 'b.jpg': 40 })
  expect(ezeli(['hide', first.key, String(numberOf(first, /\[Photo\]/))]).status).toBe(0)
  expect((await photoMemories(chatId)).length).toBe(1)

  // a.jpg saved again at another quality: other bytes, the same picture.
  const newer = await exportOf(afterDeleting(), { 'a.jpg': 201, 'b.jpg': 40 })
  const again = importChat(chat, { people, folder: newer })

  expect(again.status).toBe(0)
  expect((await photoMemories(chatId)).length).toBe(1)
  expect((await friendPhotos(friend, chatId)).length).toBe(1)
  expect((await chatFiles(chatId)).length).toBe(2)
  expect(again.out).toMatch(/Added:\s+0 memories, 0 messages, 0 photos/)
})

test('a photo imported before hashes were stored is hidden with every photo of that person in that minute, and the owner is told first', async () => {
  const { chat, chatId, people, first, friend } = await ownChat(base([photoLine('10:05:50', 'Limon L', 'c.jpg')]), { 'a.jpg': 200, 'b.jpg': 40, 'c.jpg': 120 })
  await owner.from('photos').update({ content_hash: null }).eq('memory_id', first.id)

  const result = ezeli(['hide', first.key, String(numberOf(first, /\[Photo\]/))])

  expect(result.status).toBe(0)
  expect(result.out).toMatch(/The match is not exact, so this goes with it:\n {2}.*Limon.*: photo\n/)
  expect(result.out).toMatch(/Hidden: 2 messages \(2 photos/)
  expect((await photoMemories(chatId)).length).toBe(1)
  // A newer export: still hidden, and nothing else is lost.
  const again = importChat(chat, { people, folder: await exportOf(afterDeleting([photoLine('10:05:50', 'Limon L', 'c.jpg')]), { 'a.jpg': 200, 'b.jpg': 40, 'c.jpg': 120 }) })
  expect(again.status).toBe(0)
  expect((await friendPhotos(friend, chatId)).length).toBe(1)
})

test('with a stored hash only that photo goes; another photo of the same minute stays, after the key shift as well', async () => {
  const { chat, chatId, people, first, friend } = await ownChat(base([photoLine('10:05:50', 'Limon L', 'c.jpg')]), { 'a.jpg': 200, 'b.jpg': 40, 'c.jpg': 120 })

  const result = ezeli(['hide', first.key, String(numberOf(first, /\[Photo\]/))])

  expect(result.out).not.toMatch(/not exact/)
  expect(result.out).toMatch(/Hidden: 1 message/)
  expect((await photoMemories(chatId)).length).toBe(2)
  const again = importChat(chat, { people, folder: await exportOf(afterDeleting([photoLine('10:05:50', 'Limon L', 'c.jpg')]), { 'a.jpg': 200, 'b.jpg': 40, 'c.jpg': 120 }) })
  expect(again.status).toBe(0)
  expect((await friendPhotos(friend, chatId)).length).toBe(2)
})

test('a hidden text is hidden wherever it is: both identical messages of the minute, and again after an earlier one is deleted', async () => {
  const lines = (twice: boolean) => [...(twice ? [textLine('11:00:10', 'Limon L', 'tamam')] : []), textLine('11:00:40', 'Limon L', 'tamam'), textLine('11:00:50', 'Fıstık F', 'Biz de geliyoruz'), photoLine('11:01:00', 'Karpuz K', 'a.jpg')]
  const { chat, people, first, friend } = await ownChat(lines(true), { 'a.jpg': 90 })
  const talk = async () => (await rows<{ text: string }>(friend.from('messages').select('text').eq('memory_id', first.id))).filter((m) => m.text === 'tamam').length
  expect(await talk()).toBe(2)

  ezeli(['hide', first.key, String(numberOf(first, /tamam/) + 1)])
  expect(await talk()).toBe(0)

  expect(importChat(chat, { people, folder: await exportOf(lines(false), { 'a.jpg': 90 }) }).status).toBe(0)
  expect(await talk()).toBe(0)
})

test('a hidden photo stays hidden when the same chat is imported again with other grouping numbers, and nothing is added', async () => {
  const { chat, people, folder, first, friend } = await setup()
  const [shown] = await photoRows(first)
  ezeli(['hide', first.key, String(numberOf(first, /\[Photo\]/))])

  const again = importChat(chat, { people, folder, extra: ['--photo-gap', '5'] })

  expect(again.status).toBe(0)
  expect(await rows(owner.from('photos').select('key').in('key', [shown!.key]))).toEqual([])
  expect(await exists(shown!.view_path)).toBe(false)
  expect((await friendMemories(friend, chat)).length).toBe(2)
  // A plain import after it adds nothing, and the summary does not count what is hidden.
  const plain = importChat(chat, { people, folder })
  expect(plain.out).toMatch(/Added:\s+0 memories, 0 messages, 0 photos/)
})

test('hiding the only photo of a memory removes the memory and its comments, and says so', async () => {
  const { chat, second, friend } = await setup()
  const comment = await friend.from('comments').insert({ memory_id: second.id, body: 'Ne güzel gündü' }).select('id').single()
  expect(comment.error).toBeNull()
  expect((await friendMemories(friend, chat)).length).toBe(2)

  const result = ezeli(['hide', second.key, String(numberOf(second, /\[Photo\]/))])

  expect(result.status).toBe(0)
  expect(result.out).toMatch(/Hidden: 1 message \(1 photo with their files\); 1 memory and 1 comment removed/)
  expect(await rows(owner.from('memories').select('id').eq('id', second.id))).toEqual([])
  expect(await rows(owner.from('comments').select('id').eq('id', comment.data!.id))).toEqual([])
  expect(await rows(friend.from('timeline').select('id').eq('id', second.id))).toEqual([])
  expect((await friend.rpc('memory_detail', { p_key: second.key })).data).toBeNull()
  expect((await friend.rpc('memory_detail', { p_key: 'no-such-memory' })).data).toBeNull()
  expect(ezeli(['memory', second.key]).status).toBe(1)
})

// The numbers of what is hidden in a chat, in the owner's listing.
function hiddenNumbers(chat: string): number[] {
  const out: number[] = []
  let inChat = false
  for (const line of ezeli(['hidden']).out.split('\n')) {
    if (!line.startsWith(' ')) inChat = line.trim() === chat
    else if (inChat) out.push(Number(line.trim().split(/\s+/)[0]))
  }
  return out
}

test('hiding a whole memory, listing what is hidden, and showing it: everything returns with the next import', async () => {
  const { chat, people, folder, first, friend } = await setup()
  const held = await rows<{ key: string }>(owner.from('messages').select('key').eq('memory_id', first.id))
  const chatId = (await storedChat(chat))!.id as string

  const hiding = ezeli(['hide', first.key])

  expect(hiding.out).toMatch(new RegExp(`Hidden: ${held.length} messages \\(2 photos with their files\\); 1 memory and 0 comments removed`))
  expect((await friendMemories(friend, chat)).length).toBe(1)
  expect(await rows(owner.from('messages').select('key').eq('memory_id', first.id))).toEqual([])
  // The listing names it.
  const numbers = hiddenNumbers(chat)
  expect(numbers.length).toBeGreaterThan(0)
  expect(ezeli(['hidden']).out).toMatch(/Limon.*: photo/)

  // From the last number down, so the numbers still to do stay as they were listed.
  for (const number of [...numbers].reverse()) ezeli(['show', String(number)])
  expect(hiddenNumbers(chat)).toEqual([])
  const shown = ezeli(['show', '9999'])
  expect(shown.status).toBe(1)
  // Nothing is back until the import: it returns messages and photos alike.
  expect((await friendMemories(friend, chat)).length).toBe(1)
  expect(importChat(chat, { people, folder }).out).toMatch(/Added:\s+1 memory, \d+ messages, 2 photos/)
  expect((await friendMemories(friend, chat)).length).toBe(2)
  expect((await photoMemories(chatId)).length).toBe(3)
})

test('a hidden message returns only with the next import once it is shown', async () => {
  const { chat, people, folder, first, friend } = await setup()
  const text = () => friend.from('messages').select('key').eq('memory_id', first.id).ilike('text', '%Ben geldim bile%')
  ezeli(['hide', first.key, String(numberOf(first, /Ben geldim bile/))])
  expect(await rows(text())).toEqual([])
  const [number] = hiddenNumbers(chat)

  expect(ezeli(['show', String(number)]).out).toMatch(/returns with the next import/)
  expect(await rows(text())).toEqual([])

  expect(importChat(chat, { people, folder }).status).toBe(0)
  expect((await rows(text())).length).toBe(1)
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

test('a hide that lands while an import runs is put right by the import itself', async () => {
  const { chat, chatId, people, first, friend } = await setup()
  // A newer export of the chat: one more photo the next day.
  const newer = copyOfWeekend()
  await distinct(newer)
  appendFileSync(join(newer, '_chat.txt'), [`${LRM}[16.07.2023, 09:00:00] Limon L: ${LRM}<attached: new.jpg>`, ''].join('\n'))
  await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 250, g: 10, b: 10 } } }).jpeg().toFile(join(newer, 'new.jpg'))
  const pause = join(mkdtempSync(join(tmpdir(), 'ezeli-pause-')), 'p')
  const running = spawn('node', ['cli/ezeli.ts', 'import', newer, '--people', peopleFile(people), '--timezone', 'Europe/Istanbul', '--chat', chat], {
    env: { ...process.env, SUPABASE_URL: stack.apiUrl, SUPABASE_SECRET_KEY: stack.secretKey, EZELI_TEST_PAUSE: pause, EZELI_SWEEP_AFTER_MS: '60000' },
  })
  let errText = ''
  running.stderr.on('data', (chunk) => (errText += chunk))
  const finished = new Promise<number | null>((resolve) => running.on('close', resolve))
  for (let waited = 0; waited < 200; waited++) {
    try {
      readFileSync(`${pause}.ready`)
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  // The import has read what is stored; now an owner hides the first photo.
  expect(ezeli(['hide', first.key, String(numberOf(first, /\[Photo\]/))], { EZELI_SWEEP_AFTER_MS: '60000' }).status).toBe(0)
  writeFileSync(`${pause}.go`, '')

  const code = await finished
  expect(errText).toBe('')
  expect(code).toBe(0)
  expect((await friendPhotos(friend, chatId)).length).toBe(3)
  expect((await photoMemories(chatId)).length).toBe(3)
  expect((await chatFiles(chatId)).length).toBe(6)
})

test('files left behind by a hide that could not remove them are removed by the next import', async () => {
  const { chat, chatId, people, folder, first } = await setup()
  const [hidden] = await photoRows(first)
  ezeli(['hide', first.key, String(numberOf(first, /\[Photo\]/))])
  // As if the removal had failed after the rows went: the files are back in the bucket.
  for (const path of [hidden!.view_path, hidden!.thumb_path]) await owner.storage.from('photos').upload(path, new Blob(['x'], { type: 'image/webp' }), { contentType: 'image/webp' })
  expect(await exists(hidden!.view_path)).toBe(true)

  // Files younger than a minute are left alone (an import still running has not given them a row yet).
  const args = [folder, '--people', peopleFile(people), '--timezone', 'Europe/Istanbul', '--chat', chat]
  expect(ezeliImport(args, { EZELI_SWEEP_AFTER_MS: '60000' }).status).toBe(0)
  expect(await exists(hidden!.view_path)).toBe(true)
  expect(ezeliImport(args, { EZELI_SWEEP_AFTER_MS: '0' }).status).toBe(0)

  expect(await exists(hidden!.view_path)).toBe(false)
  expect(await exists(hidden!.thumb_path)).toBe(false)
  expect((await chatFiles(chatId)).length).toBe(4)
})

test('hiding twice is not an error; a wrong address or number or a missing setting is one plain line', async () => {
  const { first } = await setup()
  const number = String(numberOf(first, /\[Photo\]/))
  expect(ezeli(['hide', first.key, number]).status).toBe(0)

  const moved = ezeli(['hide', first.key, number]).err
  const address = (await rows<{ key: string }>(owner.from('memories').select('key').eq('id', first.id)))[0]!.key
  expect(moved).toMatch(/No memory has that address/)

  const twice = ezeli(['hide', address, '1'])

  expect(twice.status).toBe(0)
  expect(twice.err).toBe('')
  expect(ezeli(['hide', 'no-such-memory']).status).toBe(1)
  expect(ezeli(['hide', address, '99']).err).toMatch(/no item number 99/)
  expect(ezeli(['hide', address, 'one']).status).toBe(1)
  const unset = ezeli(['hide', address, '1'], { SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' })
  expect(unset.status).toBe(1)
  expect(unset.err.trim().split('\n')).toEqual(['Set SUPABASE_URL, SUPABASE_SECRET_KEY in the environment first.'])
})

test('a friend cannot read what lets a key be worked out or a hidden thing be found, and a chat has its own secret', async () => {
  const { chat, friend } = await setup()

  expect((await friend.from('chats').select('secret')).error).not.toBeNull()
  expect((await friend.from('photos').select('content_hash')).error).not.toBeNull()
  expect((await friend.from('hidden').select('*')).error).not.toBeNull()
  expect((await friend.from('hidden').insert({ chat_key: 'x', person_slug: 'x', minute: new Date().toISOString(), kind: 'text' })).error).not.toBeNull()
  const secret = (await storedChat(chat))!.secret as string
  expect(secret).toMatch(/^[0-9a-f]{48}$/)
})

test('comments of a memory that goes cannot be read or added, and a regroup does not move them to another memory', async () => {
  const { chat, people, folder, first, friend } = await setup()
  const added = await friend.from('comments').insert({ memory_id: first.id, body: 'Ne güzel gündü' }).select('id').single()
  expect(added.error).toBeNull()

  expect(ezeli(['hide', first.key]).out).toMatch(/1 memory and 1 comment removed/)

  expect(await rows(friend.from('comments').select('id').eq('memory_id', first.id))).toEqual([])
  expect((await friend.from('comments').insert({ memory_id: first.id, body: 'Hâlâ burada mısınız' })).error).not.toBeNull()
  expect(importChat(chat, { people, folder, extra: ['--photo-gap', '5'] }).status).toBe(0)
  expect(await rows(owner.from('comments').select('id').eq('id', added.data!.id))).toEqual([])
})
