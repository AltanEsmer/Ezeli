// Hiding, at the import seam: the real import and the real owner commands on a made-up export, then
// what a friend's own session can read (tables, view, function, bucket) and what is stored.
import { expect, test } from 'vitest'
import { ezeli, fresh, freshPeople, importChat, owner, rows, signedInAs, storedChat } from './support.ts'

type Memory = { id: string; key: string }

async function setup() {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  expect(importChat(chat, { people }).status).toBe(0)
  const memories = await rows<Memory>(owner.from('memories').select('id, key').eq('chat_id', (await storedChat(chat))!.id as string).order('at'))
  return { chat, people, first: memories[0]!, second: memories[1]!, friend: await signedInAs(fresh('Limon')) }
}

// The number of the first line of a memory's listing that matches.
function numberOf(memory: Memory, matching: RegExp): number {
  const listing = ezeli(['memory', `https://ezeli.example/m/${memory.key}`]).out
  const found = listing.split('\n').find((line) => matching.test(line))
  if (!found) throw new Error(`no line matches ${matching} in\n${listing}`)
  return Number(found.trim().split(/\s+/)[0])
}

const photoRows = async (memory: Memory) => rows<{ key: string; view_path: string; thumb_path: string }>(owner.from('photos').select('key, view_path, thumb_path').eq('memory_id', memory.id))
const exists = async (path: string) => !(await owner.storage.from('photos').download(path)).error

test('hiding a photo: nobody signed in can read it, its files are gone, and the others stay', async () => {
  const { first, friend } = await setup()
  const [shown, other] = await photoRows(first)
  const photo = numberOf(first, /\[Photo\]/)

  const result = ezeli(['hide', first.key, String(photo)])
  expect(result.status).toBe(0)
  expect(result.out).toMatch(/Hidden 1 item; 1 photo removed/)

  // The photo's row and its message are not readable; the other photo and the rest are.
  expect(await rows(friend.from('photos').select('key').eq('key', shown!.key))).toEqual([])
  expect(await rows(friend.from('messages').select('key').eq('key', shown!.key))).toEqual([])
  expect((await rows(friend.from('photos').select('key').eq('memory_id', first.id))).length).toBe(1)
  // Both sizes are removed from the bucket, and no signed link can be made for them.
  expect(await exists(shown!.view_path)).toBe(false)
  expect(await exists(shown!.thumb_path)).toBe(false)
  expect((await friend.storage.from('photos').createSignedUrl(shown!.view_path, 60)).data).toBeNull()
  // The photo count, the people who sent it, the memory function and the conversation follow.
  const timeline = await rows<{ id: string; photo_count: number; senders: string[] }>(friend.from('timeline').select('id, photo_count, senders').eq('id', first.id))
  expect(timeline[0]!.photo_count).toBe(1)
  const detail = (await friend.rpc('memory_detail', { p_key: first.key })).data as { photos: unknown[]; messages: { id: string }[] }
  expect(detail.photos.length).toBe(1)
  expect(detail.messages.filter((m) => (m as unknown as { kind: string }).kind === 'photo').length).toBe(1)
  expect(other).toBeDefined()
  // The owner still sees everything, marked.
  expect(ezeli(['memory', first.key]).out).toMatch(/\[Photo\]   \(hidden\)/)
})

test('a hidden photo stays hidden when the same chat is imported again with other grouping numbers', async () => {
  const { chat, people, first, friend } = await setup()
  const [shown] = await photoRows(first)
  ezeli(['hide', first.key, String(numberOf(first, /\[Photo\]/))])

  // A smaller gap puts the memory's two photos in two memories.
  const again = importChat(chat, { people, extra: ['--photo-gap', '5'] })
  expect(again.status).toBe(0)

  const stored = await rows<{ key: string }>(owner.from('photos').select('key').in('key', [shown!.key]))
  expect(stored).toEqual([])
  expect(await exists(shown!.view_path)).toBe(false)
  expect(await exists(shown!.thumb_path)).toBe(false)
  expect(await rows(friend.from('messages').select('key').eq('key', shown!.key))).toEqual([])
  // The other two photos regrouped into a memory each; the hidden photo's own memory has nothing
  // left to show.
  const chatId = (await storedChat(chat))!.id as string
  expect((await rows(friend.from('memories').select('id').eq('chat_id', chatId))).length).toBe(2)
})

test('hiding the only photo of a memory takes the memory off the timeline and its address answers as if it were not there', async () => {
  const { chat, second, friend } = await setup()
  const chatId = (await storedChat(chat))!.id as string
  expect((await rows(friend.from('memories').select('id').eq('chat_id', chatId))).length).toBe(2)

  const result = ezeli(['hide', second.key, String(numberOf(second, /\[Photo\]/))])

  expect(result.status).toBe(0)
  expect(await rows(friend.from('timeline').select('id').eq('id', second.id))).toEqual([])
  expect(await rows(friend.from('memories').select('id').eq('id', second.id))).toEqual([])
  expect((await friend.rpc('memory_detail', { p_key: second.key })).data).toBeNull()
  expect((await friend.rpc('memory_detail', { p_key: 'no-such-memory' })).data).toBeNull()
  // The memory before it no longer points to it as the next one.
  const first = (await rows<Memory>(owner.from('memories').select('id, key').eq('chat_id', chatId).order('at')))[0]!
  expect(((await friend.rpc('memory_detail', { p_key: first.key })).data as { after: string | null }).after).not.toBe(second.key)
  // The owner still finds it, to show it again.
  expect(ezeli(['memory', second.key]).status).toBe(0)
})

test('hiding a whole memory hides every photo and message in it, and showing it returns the messages', async () => {
  const { first, friend } = await setup()
  const held = await rows<{ key: string }>(owner.from('messages').select('key').eq('memory_id', first.id))

  expect(ezeli(['hide', first.key]).out).toMatch(new RegExp(`Hidden the whole memory: ${held.length} items`))
  expect(await rows(friend.from('messages').select('key').eq('memory_id', first.id))).toEqual([])
  expect(await rows(friend.from('memories').select('id').eq('id', first.id))).toEqual([])

  const shown = ezeli(['show', first.key])
  expect(shown.out).toMatch(new RegExp(`Shown again: ${held.length} items`))
  expect(shown.out).toMatch(/return with the next import/)
  // The memory, with its messages, waits for its photos, which the next import adds. Nothing of it
  // can be read meanwhile.
  expect(await rows(friend.from('memories').select('id').eq('id', first.id))).toEqual([])
  expect(await rows(friend.from('messages').select('key').eq('memory_id', first.id))).toEqual([])
  expect(await rows(owner.from('hidden').select('key').in('key', held.map((m) => m.key)))).toEqual([])
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
})

test('a hidden photo returns with the next import once it is shown', async () => {
  const { chat, people, first, friend } = await setup()
  const [shown] = await photoRows(first)
  const photo = numberOf(first, /\[Photo\]/)
  ezeli(['hide', first.key, String(photo)])

  expect(ezeli(['show', first.key, String(photo)]).out).toMatch(/return with the next import|returns with the next import/)
  expect(await rows(friend.from('photos').select('key').eq('key', shown!.key))).toEqual([])

  expect(importChat(chat, { people }).status).toBe(0)
  expect((await rows(friend.from('photos').select('key').eq('key', shown!.key))).length).toBe(1)
})

test('what is hidden is not even listed to a signed-in person, and a wrong address or number is refused', async () => {
  const { first, friend } = await setup()
  ezeli(['hide', first.key, '1'])

  expect((await friend.from('hidden').select('*')).data ?? []).toEqual([])
  expect((await friend.from('hidden').insert({ key: 'x' })).error).not.toBeNull()
  expect(ezeli(['hide', 'no-such-memory']).status).toBe(1)
  expect(ezeli(['hide', first.key, '99']).err).toMatch(/no item number 99/)
  expect(ezeli(['hide', first.key, 'one']).status).toBe(1)
})
