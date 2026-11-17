// Importing the same chat again must find what is already stored, so a later import (issue 13)
// adds only what is new and a hidden item (issue 20) stays hidden. These cases change one thing
// between two imports and check that nothing is stored twice.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { copyOfWeekend, counts, ezeliImport, fresh, freshPeople, importChat, owner, rows, storedChat } from './support.ts'

const firstPhoto = '00000007-PHOTO-2023-07-14-20-58-11.jpg'
const lastPhoto = '00000020-PHOTO-2023-07-15-11-05-00.jpg'

test('renaming a person in the people file renames them and stores nothing twice', async () => {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  expect(importChat(chat, { people }).status).toBe(0)
  const before = await counts(chat)

  const renamed = { ...people, limon: `${people.limon} Hanım` }
  expect(importChat(chat, { people: renamed }).status).toBe(0)

  expect(await counts(chat)).toEqual(before)
  const limon = await rows<{ display_name: string }>(owner.from('people').select('display_name').eq('slug', people.ids.limon))
  expect(limon).toEqual([{ display_name: renamed.limon }])
  expect(await rows(owner.from('people').select('id').eq('display_name', people.limon))).toEqual([])
})

test('an edited caption does not make a second photo', async () => {
  const folder = copyOfWeekend()
  const chatFile = join(folder, '_chat.txt')
  const original = readFileSync(chatFile, 'utf8')
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  writeFileSync(chatFile, original.replace(`<attached: ${firstPhoto}>`, `<attached: ${firstPhoto}> güzel`))
  expect(importChat(chat, { folder, people }).status).toBe(0)
  const before = await counts(chat)

  writeFileSync(chatFile, original.replace(`<attached: ${firstPhoto}>`, `<attached: ${firstPhoto}> çok güzel`))
  expect(importChat(chat, { folder, people }).status).toBe(0)

  expect(await counts(chat)).toEqual(before)
  const texts = await rows<{ text: string }>(owner.from('messages').select('text').eq('media_kind', 'photo'))
  expect(texts.map((m) => m.text)).toContain('çok güzel')
})

test('a first photo whose file was missing the first time keeps its memory when the file comes', async () => {
  const folder = copyOfWeekend()
  rmSync(join(folder, firstPhoto))
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  expect(importChat(chat, { folder, people }).status).toBe(0)
  const before = await counts(chat)
  expect(before).toEqual({ memories: 2, messages: 11, photos: 2 })
  const memoriesBefore = await rows<{ key: string }>(owner.from('memories').select('key').eq('chat_id', (await storedChat(chat))!.id as string).order('key'))

  const back = copyOfWeekend()
  expect(importChat(chat, { folder: back, people }).status).toBe(0)

  // One more photo, in the same memory; no memory or message is added.
  expect(await counts(chat)).toEqual({ memories: 2, messages: 11, photos: 3 })
  const memoriesAfter = await rows<{ key: string }>(owner.from('memories').select('key').eq('chat_id', (await storedChat(chat))!.id as string).order('key'))
  expect(memoriesAfter).toEqual(memoriesBefore)
})

test('a different time zone for a chat already imported stops the run and re-dates nothing', async () => {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  expect(importChat(chat, { people }).status).toBe(0)
  const before = await counts(chat)
  const at = await rows(owner.from('memories').select('at').eq('chat_id', (await storedChat(chat))!.id as string).order('at'))

  const again = importChat(chat, { people, timezone: 'Europe/London' })

  expect(again.status).toBe(1)
  expect(again.err).toContain('Europe/Istanbul')
  expect(again.err).toContain('Europe/London')
  expect((await storedChat(chat))!.timezone).toBe('Europe/Istanbul')
  expect(await counts(chat)).toEqual(before)
  expect(await rows(owner.from('memories').select('at').eq('chat_id', (await storedChat(chat))!.id as string).order('at'))).toEqual(at)
})

test('a person made earlier by person add is adopted by the import, not duplicated', async () => {
  const people = freshPeople()
  const earlier = await owner.from('people').insert({ display_name: people.karpuz }).select('id').single()
  expect(importChat(fresh('Kaş Tatili'), { people }).status).toBe(0)

  const stored = await rows<{ id: string; slug: string }>(owner.from('people').select('id, slug').eq('display_name', people.karpuz))
  expect(stored).toEqual([{ id: earlier.data!.id, slug: people.ids.karpuz }])
})

test('a memory whose photos are all missing from the export is not on the timeline', async () => {
  const folder = copyOfWeekend()
  rmSync(join(folder, lastPhoto))
  const chat = fresh('Kaş Tatili')
  expect(importChat(chat, { folder }).status).toBe(0)

  const onTimeline = await rows<{ at: string }>(owner.from('timeline').select('at').eq('chat_name', chat))
  expect(onTimeline.map((m) => new Date(m.at).toISOString())).toEqual(['2023-07-14T17:58:11.000Z'])
})

test('a save that fails ends with one plain line and no stack, and running it again finishes the job', async () => {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  const taken = await owner.from('people').insert({ display_name: `${people.limon} Hanım` })
  expect(taken.error).toBeNull()
  expect(importChat(chat, { people }).status).toBe(0)

  // Renaming onto a name another person has: the database refuses halfway through.
  const clash = importChat(chat, { people: { ...people, limon: `${people.limon} Hanım` } })
  expect(clash.status).toBe(1)
  expect(clash.err.trim().split('\n').length).toBeLessThanOrEqual(2)
  expect(clash.err).not.toMatch(/\n\s+at /)
  expect(clash.err).toContain(`${people.limon} Hanım`)

  const again = importChat(chat, { people })
  expect(again.status).toBe(0)
  expect(await counts(chat)).toEqual({ memories: 2, messages: 11, photos: 3 })
})

test('when the database cannot be reached the import says so in plain words and exits with an error', { timeout: 30_000 }, () => {
  const result = ezeliImport(
    ['tests/fixtures/whatsapp-iphone/weekend', '--people', 'tests/fixtures/whatsapp-iphone/people.json', '--timezone', 'Europe/Istanbul', '--chat', 'x'],
    { SUPABASE_URL: 'http://127.0.0.1:9' },
  )

  expect(result.status).toBe(1)
  expect(result.err).toContain('run the same import again')
  expect(result.err).not.toMatch(/\n\s+at /)
})
