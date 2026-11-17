// Importing again, at the import seam: made-up exports in, what is stored and what is printed out.
// The same export twice, a newer one, an older one after a newer one, and other grouping numbers.
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { copyOfWeekend, counts, ezeliImport, fixtures, fresh, freshPeople, importChat, owner, rows, storedChat } from './support.ts'

const firstPhoto = '00000007-PHOTO-2023-07-14-20-58-11.jpg'

// The weekend export, grown the way a later export of the same chat grows: the last memory goes on
// for a few minutes, and a new photo with a few messages comes the next day.
function newerWeekend(): string {
  const folder = copyOfWeekend()
  copyFileSync(join(folder, firstPhoto), join(folder, '00000030-PHOTO-2023-07-16-09-00-00.jpg'))
  appendFileSync(
    join(folder, '_chat.txt'),
    [
      '[15.07.2023, 11:20:00] Limon L: Tekne ne zaman kalkıyor',
      '[16.07.2023, 08:55:00] Karpuz K: Günaydın',
      '‎[16.07.2023, 09:00:00] Limon L: ‎<attached: 00000030-PHOTO-2023-07-16-09-00-00.jpg>',
      '[16.07.2023, 09:01:00] Fıstık F: Bu da güzel',
      '',
    ].join('\n'),
  )
  return folder
}

const weekend = { memories: 2, messages: 11, photos: 3 }
const newer = { memories: 3, messages: 15, photos: 4 }

async function memoryKeys(chat: string) {
  const found = await rows<{ key: string }>(owner.from('memories').select('key').eq('chat_id', (await storedChat(chat))!.id as string).order('key'))
  return found.map((m) => m.key)
}

async function photoPaths(chat: string) {
  const ids = (await rows<{ id: string }>(owner.from('memories').select('id').eq('chat_id', (await storedChat(chat))!.id as string))).map((m) => m.id)
  return (await rows<{ view_path: string }>(owner.from('photos').select('view_path').in('memory_id', ids))).map((p) => p.view_path)
}

test('the summary of a first import says everything was added', () => {
  const result = importChat(fresh('Kaş Tatili'))

  expect(result.out).toMatch(/Added:\s+2 memories, 11 messages, 3 photos/)
  expect(result.out).toMatch(/Already there:\s+0 memories, 0 messages, 0 photos/)
  expect(result.out).toMatch(/Removed:\s+0 memories, 0 messages, 0 photos/)
})

test('importing the same export twice changes nothing and says it was all there', async () => {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  importChat(chat, { people })
  const keys = await memoryKeys(chat)

  const again = importChat(chat, { people })

  expect(again.status).toBe(0)
  expect(again.out).toMatch(/Added:\s+0 memories, 0 messages, 0 photos/)
  expect(again.out).toMatch(/Already there:\s+2 memories, 11 messages, 3 photos/)
  expect(again.out).toMatch(/Removed:\s+0 memories, 0 messages, 0 photos/)
  expect(await counts(chat)).toEqual(weekend)
  expect(await memoryKeys(chat)).toEqual(keys)
})

test('a newer export adds only the new memories, messages and photos, and the last memory grows', async () => {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  importChat(chat, { people })
  const keys = await memoryKeys(chat)

  const later = importChat(chat, { people, folder: newerWeekend() })

  expect(later.status).toBe(0)
  expect(later.out).toMatch(/Added:\s+1 memory, 4 messages, 1 photo/)
  expect(later.out).toMatch(/Already there:\s+2 memories, 11 messages, 3 photos/)
  expect(later.out).toMatch(/Removed:\s+0 memories, 0 messages, 0 photos/)
  expect(await counts(chat)).toEqual(newer)
  // The old memories are the same memories.
  expect((await memoryKeys(chat)).filter((key) => keys.includes(key))).toEqual(keys)
})

test('an older export imported after a newer one removes nothing the newer one added', async () => {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  importChat(chat, { people, folder: newerWeekend() })

  const older = importChat(chat, { people })

  expect(older.status).toBe(0)
  expect(older.out).toMatch(/Added:\s+0 memories, 0 messages, 0 photos/)
  expect(older.out).toMatch(/Removed:\s+0 memories, 0 messages, 0 photos/)
  expect(await counts(chat)).toEqual(newer)
})

test('two identical messages in the same minute are both kept, and a third in a newer export is the only addition', async () => {
  const folder = copyOfWeekend()
  const file = join(folder, '_chat.txt')
  const original = readFileSync(file, 'utf8')
  const tamam = (seconds: string) => `[14.07.2023, 20:59:${seconds}] Limon L: tamam\n`
  const withTamam = (...seconds: string[]) => original.replace('[14.07.2023, 20:59:40]', seconds.map(tamam).join('') + '[14.07.2023, 20:59:40]')
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  writeFileSync(file, withTamam('10', '20'))
  importChat(chat, { people, folder })
  expect(await counts(chat)).toEqual({ ...weekend, messages: 13 })

  expect(importChat(chat, { people, folder }).out).toMatch(/Added:\s+0 memories, 0 messages, 0 photos/)
  expect(await counts(chat)).toEqual({ ...weekend, messages: 13 })

  writeFileSync(file, withTamam('10', '20', '30'))
  const later = importChat(chat, { people, folder })

  expect(later.out).toMatch(/Added:\s+0 memories, 1 message, 0 photos/)
  expect(await counts(chat)).toEqual({ ...weekend, messages: 14 })
})

test('a smaller photo gap splits a memory and the starting numbers join it again, with no photo doubled', async () => {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  importChat(chat, { people })
  const keys = await memoryKeys(chat)
  const paths = (await photoPaths(chat)).sort()

  const split = importChat(chat, { people, extra: ['--photo-gap', '5'] })
  expect(split.status).toBe(0)
  expect(split.out).toMatch(/Added:\s+1 memory, 0 messages, 0 photos/)
  expect(split.out).toMatch(/Removed:\s+0 memories, 0 messages, 0 photos/)
  expect(await counts(chat)).toEqual({ memories: 3, messages: 11, photos: 3 })

  const joined = importChat(chat, { people })
  expect(joined.out).toMatch(/Added:\s+0 memories, 0 messages, 0 photos/)
  expect(joined.out).toMatch(/Removed:\s+1 memory, 0 messages, 0 photos/)
  expect(await counts(chat)).toEqual(weekend)
  expect(await memoryKeys(chat)).toEqual(keys)
  expect((await photoPaths(chat)).sort()).toEqual(paths)
})

test('messages that no longer belong to any memory are removed, and come back when the numbers do', async () => {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  importChat(chat, { people })

  const tight = importChat(chat, { people, extra: ['--before', '0', '--after', '0'] })

  // Only the photos and the message between them are left inside memories.
  expect(tight.out).toMatch(/Removed:\s+0 memories, 7 messages, 0 photos/)
  expect(await counts(chat)).toEqual({ memories: 2, messages: 4, photos: 3 })

  const back = importChat(chat, { people })
  expect(back.out).toMatch(/Added:\s+0 memories, 7 messages, 0 photos/)
  expect(await counts(chat)).toEqual(weekend)
})

test('a sender who is left out later loses the messages and the photo files already stored', async () => {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  importChat(chat, { people })
  const before = await photoPaths(chat)
  expect(before).toHaveLength(3)

  const file = join(mkdtempSync(join(tmpdir(), 'ezeli-people-')), 'people.json')
  writeFileSync(
    file,
    JSON.stringify({
      people: [
        { id: people.ids.karpuz, name: people.karpuz, whatsapp: ['Karpuz K'], leftOut: true },
        { id: people.ids.limon, name: people.limon, whatsapp: ['Limon L', 'Limon 🌻'] },
        { id: people.ids.fistik, name: people.fistik, whatsapp: ['Fıstık F'] },
        { id: people.ids.cilek, name: people.cilek, whatsapp: ['Çilek Ç'], leftOut: true },
      ],
    }),
  )
  const result = ezeliImport([`${fixtures}/weekend`, '--people', file, '--timezone', 'Europe/Istanbul', '--chat', chat])

  expect(result.status).toBe(0)
  expect(result.out).toMatch(/Removed:\s+0 memories, 4 messages, 1 photo\n/)
  const left = await photoPaths(chat)
  expect(left).toHaveLength(2)
  const removed = before.filter((path) => !left.includes(path))
  expect((await owner.storage.from('photos').download(removed[0]!)).error).not.toBeNull()
  expect((await owner.storage.from('photos').download(left[0]!)).error).toBeNull()
})

test('a wide photo gap in an older export joins the memories of the newer export too, and nothing is lost', async () => {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  importChat(chat, { people, folder: newerWeekend() })

  // The stored memories after the older export are joined with it before grouping, so the three
  // memories become one. Every message and photo is still there.
  const older = importChat(chat, { people, extra: ['--photo-gap', '1500'] })

  expect(older.out).toMatch(/Added:\s+0 memories, 1 message, 0 photos/)
  expect(older.out).toMatch(/Removed:\s+2 memories, 0 messages, 0 photos/)
  expect(await counts(chat)).toEqual({ memories: 1, messages: 16, photos: 4 })
})
