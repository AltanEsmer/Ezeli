// Hiding, at the import seam: the real import and the real owner commands on made-up exports, then
// what a friend's own session can read (tables, view, function, bucket) and what is stored. A hidden
// thing is gone: the marks decide what an import leaves out and what the owner command removes.
import { spawn } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, test, vi } from 'vitest'
import { copyOfWeekend, ezeli, ezeliImport, fresh, freshPeople, importChat, owner, peopleFile, rows, signedInAs, stack, storedChat, type Names } from './support.ts'

// Each test runs several real commands one after the other (each a new process). On the CI machine
// they take 5 to 10 s, not the 0.5 to 2 s of a laptop, so the 5 s default is too short here.
vi.setConfig({ testTimeout: 30_000 })

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

// The code of the nth line of a memory's listing that matches (the code is the first word of the line).
function codeFor(memory: Memory | string, matching: RegExp, nth = 0): string {
  const listing = ezeli(['memory', `https://ezeli.example/m/${typeof memory === 'string' ? memory : memory.key}`]).out
  const found = listing.split('\n').filter((line) => matching.test(line))[nth]
  if (!found) throw new Error(`no line matches ${matching} in\n${listing}`)
  return found.trim().split(/\s+/)[0]!
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

  const result = ezeli(['hide', first.key, codeFor(first, /\[Photo\]/)])

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

  expect(ezeli(['hide', address, codeFor(address, /\[media\]/)]).status).toBe(0)

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
  expect(ezeli(['hide', first.key, codeFor(first, /\[Photo\]/)]).status).toBe(0)
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

  const code = codeFor(first, /\[Photo\]/)
  // It says what else goes and waits for a yes; with no answer nothing is hidden.
  const refused = ezeli(['hide', first.key, code])
  expect(refused.status).toBe(1)
  expect(refused.out).toMatch(/Nothing was hidden/)
  expect((await photoMemories(chatId)).length).toBe(3)

  const result = ezeli(['hide', first.key, code, '--yes'])

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

  const result = ezeli(['hide', first.key, codeFor(first, /\[Photo\]/)])

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

  ezeli(['hide', first.key, codeFor(first, /tamam/, 1), '--yes'])
  expect(await talk()).toBe(0)

  expect(importChat(chat, { people, folder: await exportOf(lines(false), { 'a.jpg': 90 }) }).status).toBe(0)
  expect(await talk()).toBe(0)
})

test('a hidden photo stays hidden when the same chat is imported again with other grouping numbers, and nothing is added', async () => {
  const { chat, people, folder, first, friend } = await setup()
  const [shown] = await photoRows(first)
  ezeli(['hide', first.key, codeFor(first, /\[Photo\]/)])

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

  const result = ezeli(['hide', second.key, codeFor(second, /\[Photo\]/)])

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
function hiddenCodes(chat: string): string[] {
  const out: string[] = []
  let inChat = false
  for (const line of ezeli(['hidden']).out.split('\n')) {
    if (!line.startsWith(' ')) inChat = line.trim() === chat
    else if (inChat) out.push(line.trim().split(/\s+/)[0]!)
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
  const codes = hiddenCodes(chat)
  expect(codes.length).toBeGreaterThan(0)
  expect(ezeli(['hidden']).out).toMatch(/Limon.*: photo/)

  for (const code of codes) ezeli(['show', code])
  expect(hiddenCodes(chat)).toEqual([])
  const shown = ezeli(['show', 'ffffffff'])
  expect(shown.status).toBe(1)
  expect(shown.err).toMatch(/Nothing hidden has the code/)
  // Nothing is back until the import: it returns messages and photos alike.
  expect((await friendMemories(friend, chat)).length).toBe(1)
  expect(importChat(chat, { people, folder }).out).toMatch(/Added:\s+1 memory, \d+ messages, 2 photos/)
  expect((await friendMemories(friend, chat)).length).toBe(2)
  expect((await photoMemories(chatId)).length).toBe(3)
})

test('a hidden message returns only with the next import once it is shown', async () => {
  const { chat, people, folder, first, friend } = await setup()
  const text = () => friend.from('messages').select('key').eq('memory_id', first.id).ilike('text', '%Ben geldim bile%')
  ezeli(['hide', first.key, codeFor(first, /Ben geldim bile/)])
  expect(await rows(text())).toEqual([])
  const [code] = hiddenCodes(chat)

  expect(ezeli(['show', code!]).out).toMatch(/returns with the next import/)
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

test('a hide that lands while an import runs is put right by the import, and never takes that import\'s new files', async () => {
  const { chat, chatId, people, first, friend } = await setup()
  // A newer export of the chat: one more photo the next day.
  const newer = copyOfWeekend()
  await distinct(newer)
  appendFileSync(join(newer, '_chat.txt'), [`${LRM}[16.07.2023, 09:00:00] Limon L: ${LRM}<attached: new.jpg>`, ''].join('\n'))
  await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 250, g: 10, b: 10 } } }).jpeg().toFile(join(newer, 'new.jpg'))
  const pause = join(mkdtempSync(join(tmpdir(), 'ezeli-pause-')), 'p')
  // The import uploads its new photo, then waits here until the test lets it go.
  const running = spawn('node', ['cli/ezeli.ts', 'import', newer, '--people', peopleFile(people), '--timezone', 'Europe/Istanbul', '--chat', chat], {
    env: { ...process.env, SUPABASE_URL: stack.apiUrl, SUPABASE_SECRET_KEY: stack.secretKey, EZELI_TEST_PAUSE: pause },
  })
  let errText = ''
  running.stderr.on('data', (chunk) => (errText += chunk))
  const finished = new Promise<number | null>((resolve) => running.on('close', resolve))
  let reached = false
  for (let waited = 0; waited < 300 && !reached; waited++) {
    try {
      readFileSync(`${pause}.ready`)
      reached = true
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  // Without this the test would pass without ever having interleaved the two.
  if (!reached) throw new Error(`the import never reached its pause: ${errText}`)
  const newFiles = (await chatFiles(chatId)).length
  expect(newFiles).toBe(6 + 2)

  // The import has read what is stored and has uploaded its new photo; now an owner hides the first
  // photo and a message of the same chat. Neither may remove the import's new files.
  expect(ezeli(['hide', first.key, codeFor(first, /\[Photo\]/)]).status).toBe(0)
  const next = (await rows<{ key: string }>(owner.from('memories').select('key').eq('id', first.id)))[0]!.key
  expect(ezeli(['hide', next, codeFor(next, /Yarın tekneye/)]).status).toBe(0)
  expect((await chatFiles(chatId)).length).toBe(newFiles - 2)
  writeFileSync(`${pause}.go`, '')

  const code = await finished
  expect(errText).toBe('')
  expect(code).toBe(0)
  expect((await friendPhotos(friend, chatId)).length).toBe(3)
  expect((await photoMemories(chatId)).length).toBe(3)
  expect((await chatFiles(chatId)).length).toBe(6)
})

test('files of removed rows that cannot be removed are kept with the mark, and `hidden` removes them', async () => {
  const { chatId, first } = await setup()
  const [hidden] = await photoRows(first)
  const link = (await (await signedInAs(fresh('Limon'))).storage.from('photos').createSignedUrl(hidden!.view_path, 3600)).data!.signedUrl

  const failed = ezeli(['hide', first.key, codeFor(first, /\[Photo\]/)], { EZELI_TEST_FAIL: 'files' })

  expect(failed.status).toBe(1)
  expect(failed.err.trim().split('\n')).toHaveLength(1)
  expect(failed.err).toMatch(/pnpm ezeli hidden/)
  // The row is gone, the files are not, and until they are a link held by a friend works.
  expect(await rows(owner.from('photos').select('key').eq('key', hidden!.key))).toEqual([])
  expect(await exists(hidden!.view_path)).toBe(true)
  expect((await fetch(link)).ok).toBe(true)

  expect(ezeli(['hidden']).status).toBe(0)

  expect(await exists(hidden!.view_path)).toBe(false)
  expect(await exists(hidden!.thumb_path)).toBe(false)
  expect((await fetch(link)).ok).toBe(false)
  expect((await chatFiles(chatId)).length).toBe(4)
})

test('a hide that stops after the rows are removed is finished by `hidden`, and a code never names another thing', async () => {
  const { first, friend } = await setup()
  const before = (await rows(owner.from('messages').select('key').eq('memory_id', first.id))).length
  const code = codeFor(first, /\[Photo\]/)

  const failed = ezeli(['hide', first.key, code], { EZELI_TEST_FAIL: 'rows' })

  expect(failed.status).toBe(1)
  expect(failed.err).toMatch(/The marks are saved\. Run: pnpm ezeli hidden/)
  // The same command again cannot hide something else: the code names nothing now.
  const again = ezeli(['hide', first.key, code])
  expect(again.status).toBe(1)
  expect(again.err).toMatch(/no item with the code/)
  expect((await rows(owner.from('messages').select('key').eq('memory_id', first.id))).length).toBe(before - 1)

  expect(ezeli(['hidden']).status).toBe(0)

  const seqs = (await rows<{ seq: number }>(friend.from('messages').select('seq').eq('memory_id', first.id).order('seq'))).map((m) => m.seq)
  expect(seqs).toEqual(seqs.map((_, index) => index))
})

test('a code from the listing names the same mark after other chats got marks', async () => {
  const { chat, first } = await setup()
  ezeli(['hide', first.key, codeFor(first, /Ben geldim bile/)])
  const [code] = hiddenCodes(chat)

  // Another owner hides something in a chat that sorts before this one.
  const other = fresh('Aa Tatil')
  const folder = copyOfWeekend()
  await distinct(folder)
  expect(importChat(other, { people: freshPeople(), folder }).status).toBe(0)
  const inOther = (await rows<Memory>(owner.from('memories').select('id, key').eq('chat_id', (await storedChat(other))!.id as string).order('at')))[0]!
  expect(ezeli(['hide', inOther.key, codeFor(inOther, /Yarın tekneye/)]).status).toBe(0)

  const shown = ezeli(['show', code!])
  expect(shown.status).toBe(0)
  expect(shown.out).toContain(`(${chat})`)
  expect(hiddenCodes(other).length).toBe(1)
})

test('what an import leaves out because a mark could not match exactly is printed, and `show` brings it back', async () => {
  const lines = (a: string) => [a, photoLine('10:05:40', 'Limon L', 'c.jpg'), textLine('10:06:00', 'Karpuz K', 'Güzel'), photoLine('10:20:00', 'Karpuz K', 'b.jpg')]
  const files = { 'a.jpg': 200, 'b.jpg': 40, 'c.jpg': 120 }
  const { chat, chatId, people, first, friend } = await ownChat(lines(photoLine('10:05:10', 'Limon L', 'a.jpg')), files)
  expect(ezeli(['hide', first.key, codeFor(first, /\[Photo\]/)]).status).toBe(0)
  expect((await photoMemories(chatId)).length).toBe(2)

  // The friend deletes the hidden photo for everyone: the export no longer has it.
  const again = importChat(chat, { people, folder: await exportOf(lines(deletedLine('10:05:10', 'Limon L')), files) })

  expect(again.status).toBe(0)
  expect(again.out).toMatch(/Left out by a hidden mark: .*Limon.*, 1 other thing\. If the hidden thing is no longer in the chat, pnpm ezeli show [0-9a-f]{8} brings them back/)
  expect((await photoMemories(chatId)).length).toBe(1)
  const code = again.out.match(/pnpm ezeli show ([0-9a-f]{8})/)![1]!

  expect(ezeli(['show', code]).status).toBe(0)
  expect(importChat(chat, { people, folder: await exportOf(lines(deletedLine('10:05:10', 'Limon L')), files) }).status).toBe(0)
  expect((await friendPhotos(friend, chatId)).length).toBe(2)
})

test('a hidden video is hidden in the Android export of the same chat too, which calls every media "media omitted"', async () => {
  const iphone = [videoLine('10:05:05', 'Limon L'), photoLine('10:05:30', 'Limon L', 'a.jpg'), photoLine('10:20:00', 'Karpuz K', 'b.jpg')]
  const { chat, chatId, people, first, friend } = await ownChat(iphone, { 'a.jpg': 200, 'b.jpg': 40 })
  expect(ezeli(['hide', first.key, codeFor(first, /\[video\]/), '--yes']).status).toBe(0)

  // Android: both of Limon's media are the same line.
  const android = [textLine('10:05:05', 'Limon L', '<Media omitted>'), textLine('10:05:30', 'Limon L', '<Media omitted>'), photoLine('10:20:00', 'Karpuz K', 'b.jpg')]
  expect(importChat(chat, { people, folder: await exportOf(android, { 'b.jpg': 40 }) }).status).toBe(0)

  const memories = (await rows<{ id: string }>(owner.from('memories').select('id').eq('chat_id', chatId))).map((m) => m.id)
  const media = await rows(friend.from('messages').select('key, media_kind').in('memory_id', memories).in('media_kind', ['media', 'video']))
  expect(media).toEqual([])
  void first
})

test('every key is made with the chat\'s secret, and a chat stored without one cannot be imported again', async () => {
  const { chat, chatId, people } = await ownChat([textLine('10:06:00', 'Karpuz K', 'Güzel'), photoLine('10:20:00', 'Karpuz K', 'b.jpg')], { 'b.jpg': 40 })
  const secret = (await storedChat(chat))!.secret as string
  const stored = (await rows<{ key: string }>(owner.from('messages').select('key, memories!inner(chat_id)').eq('memories.chat_id', chatId).eq('text', 'Güzel')))[0]!

  // The key as the code makes it, with the secret and without it.
  const minute = '2023-08-14 10:06'
  const parts = (...items: (string | number)[]) => items.join('\u0001')
  const chatKey = `whatsapp:${chat.normalize('NFC').trim().toLowerCase()}`
  const withSecret = (...items: (string | number)[]) => createHmac('sha256', secret).update(parts(...items)).digest('hex').slice(0, 32)
  const plain = (...items: (string | number)[]) => createHash('sha256').update(parts(...items)).digest('hex').slice(0, 32)
  const same = (hash: typeof withSecret) => hash(chatKey, minute, people.ids.karpuz, '', 'Güzel')
  expect(stored.key).toBe(withSecret(same(withSecret), 1))
  expect(stored.key).not.toBe(plain(same(plain), 1))

  await owner.from('chats').update({ secret: null }).eq('id', chatId)
  const refused = importChat(chat, { people, folder: await exportOf([textLine('10:06:00', 'Karpuz K', 'Güzel'), photoLine('10:20:00', 'Karpuz K', 'b.jpg')], { 'b.jpg': 40 }) })
  expect(refused.status).toBe(1)
  expect(refused.err.trim().split('\n')).toHaveLength(1)
  expect(refused.err).toMatch(/stored before its keys had a secret/)
})

test('files that no row points at are removed by the next import, and by nothing else', async () => {
  const { chat, chatId, people, folder, first } = await setup()
  const [hidden] = await photoRows(first)
  ezeli(['hide', first.key, codeFor(first, /\[Photo\]/)])
  // As if the removal had failed after the rows went: the files are back in the bucket.
  for (const path of [hidden!.view_path, hidden!.thumb_path]) await owner.storage.from('photos').upload(path, new Blob(['x'], { type: 'image/webp' }), { contentType: 'image/webp' })
  expect(await exists(hidden!.view_path)).toBe(true)

  // Only an import removes files that have no row, at its own end.
  expect(ezeli(['hidden']).status).toBe(0)
  expect(await exists(hidden!.view_path)).toBe(true)
  expect(importChat(chat, { people, folder }).status).toBe(0)

  expect(await exists(hidden!.view_path)).toBe(false)
  expect(await exists(hidden!.thumb_path)).toBe(false)
  expect((await chatFiles(chatId)).length).toBe(4)
})

test('a code that names nothing, a wrong address or code, and a missing setting are one plain line each', async () => {
  const { first } = await setup()
  const code = codeFor(first, /\[Photo\]/)
  expect(ezeli(['hide', first.key, code]).status).toBe(0)
  const address = (await rows<{ key: string }>(owner.from('memories').select('key').eq('id', first.id)))[0]!.key

  const twice = ezeli(['hide', address, code])

  expect(twice.status).toBe(1)
  expect(twice.err.trim().split('\n')).toHaveLength(1)
  expect(twice.err).toMatch(/no item with the code/)
  expect(ezeli(['hide', first.key, code]).err).toMatch(/No memory has that address/)
  expect(ezeli(['hide', 'no-such-memory']).status).toBe(1)
  expect(ezeli(['hide', address, 'one']).status).toBe(1)
  const unset = ezeli(['hide', address, codeFor(address, /Çok güzel/)], { SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' })
  expect(unset.status).toBe(1)
  expect(unset.err.trim().split('\n')).toEqual(['Set SUPABASE_URL, SUPABASE_SECRET_KEY in the environment first.'])
})

test('the timeline pages and their conversation line show nothing that is hidden', async () => {
  const { first, second, friend } = await setup()
  // The page that starts at a memory (the stack holds other chats too, so ask by cursor).
  const pageAt = async (memory: Memory) => {
    const at = (await rows<{ local_at: string; key: string }>(friend.from('timeline').select('local_at, key').eq('id', memory.id)))[0]
    if (!at) return []
    return (await friend.rpc('timeline_page', { p_newer: false, p_at: at.local_at, p_key: at.key, p_limit: 1, p_inclusive: true })).data as { id: string; line: string | null }[]
  }
  expect((await pageAt(first))[0]!.line).toMatch(/Çok güzel çıkmış/)

  ezeli(['hide', first.key, codeFor(first, /Çok güzel çıkmış/)])
  ezeli(['hide', second.key, codeFor(second, /\[Photo\]/)])

  expect((await pageAt(first))[0]!.line ?? '').not.toMatch(/Çok güzel çıkmış/)
  expect(await pageAt(second)).toEqual([])
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
