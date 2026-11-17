import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { copyOfWeekend, ezeliImport, fixtures, fresh, freshPeople, importChat, owner, rows, storedChat } from './support.ts'

test('a trial run saves nothing', async () => {
  const chat = fresh('Kaş Tatili')
  const result = importChat(chat, { extra: ['--trial'] })

  expect(result.status).toBe(0)
  expect(result.out).toContain('Trial run. Nothing was saved.')
  expect(await storedChat(chat)).toBeUndefined()
  expect(await rows(owner.from('people').select('id').eq('display_name', result.people.karpuz))).toEqual([])
})

test('an unknown sender stops the import before anything is saved', async () => {
  const chat = fresh('Kaş Tatili')
  const result = ezeliImport([`${fixtures}/strangers`, '--people', `${fixtures}/people.json`, '--timezone', 'Europe/Istanbul', '--chat', chat])

  expect(result.status).toBe(1)
  expect(result.err).toContain('Not in the people file')
  expect(await storedChat(chat)).toBeUndefined()
})

test('without the secret key in the environment the import says what to set and saves nothing', async () => {
  const chat = fresh('Kaş Tatili')
  const result = ezeliImport(
    [`${fixtures}/weekend`, '--people', `${fixtures}/people.json`, '--timezone', 'Europe/Istanbul', '--chat', chat],
    { SUPABASE_SECRET_KEY: '' },
  )

  expect(result.status).toBe(1)
  expect(result.err).toContain('Set SUPABASE_SECRET_KEY in the environment first.')
  expect(await storedChat(chat)).toBeUndefined()
})

test('people are matched by display name, created without an account when new, and left-out senders are never stored', async () => {
  const people = freshPeople()
  const existing = await owner.from('people').insert({ display_name: people.limon }).select('id').single()
  const chat = fresh('Kaş Tatili')

  expect(importChat(chat, { people }).status).toBe(0)

  const stored = await rows<{ id: string; display_name: string; user_id: string | null }>(
    owner.from('people').select('id, display_name, user_id').in('display_name', [people.karpuz, people.limon, people.fistik]),
  )
  expect(stored.map((p) => p.display_name).sort()).toEqual([people.fistik, people.karpuz, people.limon].sort())
  expect(stored.every((p) => p.user_id === null)).toBe(true)
  // The person who was there already is matched, not duplicated.
  expect(stored.find((p) => p.display_name === people.limon)!.id).toBe(existing.data!.id)
  // The left-out sender has no row at all, and none of their messages is stored.
  expect(await rows(owner.from('people').select('id').eq('display_name', people.cilek))).toEqual([])
  const memories = await rows<{ id: string }>(owner.from('memories').select('id').eq('chat_id', (await storedChat(chat))!.id as string))
  const said = await rows<{ text: string }>(owner.from('messages').select('text').in('memory_id', memories.map((m) => m.id)))
  expect(said.map((m) => m.text)).not.toContain('Ben de çektim bir tane')
})

test('chats, memories, messages and photos have lasting keys; identical messages in one moment differ; saving twice leaves one copy', async () => {
  const folder = copyOfWeekend()
  writeFileSync(
    join(folder, '_chat.txt'),
    [
      '[14.07.2023, 20:58:11] Limon L: ‎<attached: 00000007-PHOTO-2023-07-14-20-58-11.jpg>',
      '[14.07.2023, 20:59:00] Fıstık F: tamam',
      '[14.07.2023, 20:59:00] Fıstık F: tamam',
    ].join('\n'),
  )
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  expect(importChat(chat, { folder, people }).status).toBe(0)
  expect(importChat(chat, { folder, people }).status).toBe(0)

  const stored = (await storedChat(chat))!
  expect(stored.key).toBe(`whatsapp:${chat.toLowerCase()}`)
  const memories = await rows<{ id: string; key: string }>(owner.from('memories').select('id, key').eq('chat_id', stored.id as string))
  const messages = await rows<{ key: string }>(owner.from('messages').select('key').eq('memory_id', memories[0]!.id))
  const photos = await rows<{ key: string }>(owner.from('photos').select('key').eq('memory_id', memories[0]!.id))
  expect(memories).toHaveLength(1)
  expect(messages).toHaveLength(3)
  expect(new Set(messages.map((m) => m.key)).size).toBe(3)
  // A memory is known by its chat and its first photo.
  expect(photos).toHaveLength(1)
  expect(memories[0]!.key).toBe(photos[0]!.key)
})
