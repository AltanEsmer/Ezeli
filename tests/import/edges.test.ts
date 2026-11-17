// The edges of an export, other chats, and a failing save. Inside the time an export covers the
// export is the truth; outside it what is stored is the truth. Made-up exports in, stored result out.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { copyOfWeekend, counts, ezeliImport, fixtures, fresh, freshPeople, importChat, owner, peopleFile, rows, storedChat } from './support.ts'

const nothing = /Added:\s+0 memories, 0 messages, 0 photos\nAlready there:.*\nRemoved:\s+0 memories, 0 messages, 0 photos/
const weekend = { memories: 2, messages: 11, photos: 3 }

// The weekend export with only the lines from the one that contains `from` on (and up to the one
// that contains `to`), as an export that starts or ends elsewhere would be.
function slice(from: string | undefined, to?: string, base = copyOfWeekend()): string {
  const file = join(base, '_chat.txt')
  const lines = readFileSync(file, 'utf8').split('\n')
  const start = from ? lines.findIndex((l) => l.includes(from)) : 0
  const end = to ? lines.findIndex((l) => l.includes(to)) : lines.length - 1
  writeFileSync(file, lines.slice(start, end + 1).join('\n') + '\n')
  return base
}

async function memoryKeys(chat: string) {
  const found = await rows<{ key: string }>(owner.from('memories').select('key').eq('chat_id', (await storedChat(chat))!.id as string).order('key'))
  return found.map((m) => m.key)
}

async function photoPaths(chat: string) {
  const ids = (await rows<{ id: string }>(owner.from('memories').select('id').eq('chat_id', (await storedChat(chat))!.id as string))).map((m) => m.id)
  return (await rows<{ view_path: string }>(owner.from('photos').select('view_path').in('memory_id', ids))).map((p) => p.view_path)
}

async function importedWeekend() {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  importChat(chat, { people })
  return { chat, people, keys: await memoryKeys(chat) }
}

test('a newer export that starts after the photos of a memory leaves the memory whole', async () => {
  const { chat, people, keys } = await importedWeekend()

  const result = importChat(chat, { people, folder: slice('21:15:20') })

  expect(result.status).toBe(0)
  expect(result.out).toMatch(nothing)
  expect(await counts(chat)).toEqual(weekend)
  expect(await memoryKeys(chat)).toEqual(keys)
})

test('a newer export that starts between two photos of a memory does not split it', async () => {
  const { chat, people, keys } = await importedWeekend()

  const result = importChat(chat, { people, folder: slice('21:12:00') })

  expect(result.out).toMatch(nothing)
  expect(await counts(chat)).toEqual(weekend)
  expect(await memoryKeys(chat)).toEqual(keys)
})

test('an older export that ends just before a photo removes nothing', async () => {
  const { chat, people } = await importedWeekend()
  // Grow the chat by a photo the next morning, with a message five minutes before it.
  const grown = copyOfWeekend()
  writeFileSync(join(grown, '_chat.txt'), readFileSync(join(grown, '_chat.txt'), 'utf8') + '[16.07.2023, 08:55:00] Karpuz K: Günaydın\n‎[16.07.2023, 09:00:00] Limon L: ‎<attached: 00000030-PHOTO-2023-07-16-09-00-00.jpg>\n')
  writeFileSync(join(grown, '00000030-PHOTO-2023-07-16-09-00-00.jpg'), readFileSync(join(grown, '00000007-PHOTO-2023-07-14-20-58-11.jpg')))
  importChat(chat, { people, folder: grown })
  const before = await counts(chat)
  expect(before).toEqual({ memories: 3, messages: 13, photos: 4 })

  const older = importChat(chat, { people, folder: slice(undefined, '08:55:00', grown) })

  expect(older.out).toMatch(nothing)
  expect(await counts(chat)).toEqual(before)
})

test('a slice from the middle of a longer export removes nothing', async () => {
  const { chat, people } = await importedWeekend()

  const result = importChat(chat, { people, folder: slice('21:12:00', '22:30:00') })

  expect(result.out).toMatch(nothing)
  expect(await counts(chat)).toEqual(weekend)
})

test('a sender left out since loses the memory that began with their photo, the other photos stay in a memory', async () => {
  const { chat, people } = await importedWeekend()
  const file = peopleFile({ ...people })
  const left = JSON.parse(readFileSync(file, 'utf8'))
  left.people.find((p: { id: string }) => p.id === people.ids.limon).leftOut = true
  writeFileSync(file, JSON.stringify(left))

  const result = ezeliImport([`${fixtures}/weekend`, '--people', file, '--timezone', 'Europe/Istanbul', '--chat', chat])

  expect(result.status).toBe(0)
  // The memory is now keyed by the next photo. The two messages of the left-out sender go, and
  // so do two earlier ones that the shorter memory no longer reaches.
  expect(result.out).toMatch(/Added:\s+1 memory, 0 messages, 0 photos/)
  expect(result.out).toMatch(/Removed:\s+1 memory, 4 messages, 1 photo\n/)
  expect(await counts(chat)).toEqual({ memories: 2, messages: 7, photos: 2 })
})

test('importing again without the photo files keeps every photo in the memory the regroup gives it', async () => {
  const { chat, people } = await importedWeekend()
  const bare = copyOfWeekend()
  for (const name of ['00000007-PHOTO-2023-07-14-20-58-11.jpg', '00000009-PHOTO-2023-07-14-21-10-05.jpg', '00000010-PHOTO-2023-07-14-21-12-00.jpg', '00000020-PHOTO-2023-07-15-11-05-00.jpg']) rmSync(join(bare, name))

  const result = importChat(chat, { people, folder: bare, extra: ['--photo-gap', '10'] })

  expect(result.status).toBe(0)
  expect(result.out).toMatch(/Already there:\s+2 memories, 11 messages, 3 photos/)
  expect(await counts(chat)).toEqual({ memories: 3, messages: 11, photos: 3 })
  const ids = (await rows<{ id: string }>(owner.from('memories').select('id').eq('chat_id', (await storedChat(chat))!.id as string))).map((m) => m.id)
  const photos = await rows<{ memory_id: string }>(owner.from('photos').select('memory_id').in('memory_id', ids))
  expect(new Set(photos.map((p) => p.memory_id)).size).toBe(3)
})

test('importing a chat again leaves the rows and files of another chat alone', async () => {
  const other = fresh('Başka Sohbet')
  importChat(other)
  const otherCounts = await counts(other)
  const otherPaths = (await photoPaths(other)).sort()
  const { chat, people } = await importedWeekend()

  importChat(chat, { people, extra: ['--before', '0', '--after', '0'] })
  importChat(chat, { people, folder: slice('21:12:00') })

  expect(await counts(other)).toEqual(otherCounts)
  expect((await photoPaths(other)).sort()).toEqual(otherPaths)
  for (const path of otherPaths) expect((await owner.storage.from('photos').download(path)).error).toBeNull()
})

// The local database, reached through its container, for the failures a test cannot cause otherwise.
function sql(statement: string) {
  const env = existsSync('supabase/.env') ? readFileSync('supabase/.env', 'utf8') : ''
  const id = env.match(/^SUPABASE_PROJECT_ID=(.+)$/m)?.[1] ?? 'ezeli'
  execFileSync('docker', ['exec', `supabase_db_${id}`, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', statement], { stdio: 'ignore' })
}

test('when the photo files cannot be removed the photo rows are already gone, and the next import clears the files', { timeout: 60_000 }, async () => {
  const { chat, people } = await importedWeekend()
  const before = await photoPaths(chat)
  const file = peopleFile({ ...people })
  const left = JSON.parse(readFileSync(file, 'utf8'))
  left.people.find((p: { id: string }) => p.id === people.ids.karpuz).leftOut = true
  writeFileSync(file, JSON.stringify(left))
  const run = () => ezeliImport([`${fixtures}/weekend`, '--people', file, '--timezone', 'Europe/Istanbul', '--chat', chat])

  sql(`create function public.ezeli_test_no_delete() returns trigger language plpgsql as $$ begin raise exception 'files are locked'; end $$; create trigger ezeli_test_no_delete before delete on storage.objects for each row when (old.name like '${(await storedChat(chat))!.id}/%') execute function public.ezeli_test_no_delete()`)
  let failed
  try {
    failed = run()
  } finally {
    sql('drop trigger ezeli_test_no_delete on storage.objects; drop function public.ezeli_test_no_delete()')
  }

  expect(failed.status).toBe(1)
  expect(failed.err.trim().split('\n').length).toBeLessThanOrEqual(2)
  expect(failed.err).toContain('same import again')
  // Only this chat's files were locked. No photo row is left without its files: the row went first.
  const left2 = await photoPaths(chat)
  expect(left2).toHaveLength(2)
  const orphan = before.find((path) => !left2.includes(path))!
  expect((await owner.storage.from('photos').download(orphan)).error).toBeNull()

  expect(run().status).toBe(0)
  expect((await owner.storage.from('photos').download(orphan)).error).not.toBeNull()
})

test('a table that points at memories and was not told about the regroup stops the import with its name', { timeout: 60_000 }, async () => {
  const { chat, people } = await importedWeekend()
  const [later] = await rows<{ key: string }>(owner.from('memories').select('key').eq('chat_id', (await storedChat(chat))!.id as string).order('at', { ascending: false }).limit(1))
  const memory = later!.key
  const table = `ezeli_test_notes_${Date.now().toString(36)}`
  sql(`create table public.${table} (memory_id uuid not null references public.memories (id) on delete restrict); insert into public.${table} select id from public.memories where key = '${memory}'`)
  try {
    // A wide photo gap joins the two memories; one of them has to go.
    const result = importChat(chat, { people, extra: ['--photo-gap', '1500'] })

    expect(result.status).toBe(1)
    expect(result.err).toContain(table)
    expect(result.err).toContain('followsMemory')
    expect(result.err).not.toMatch(/\n\s+at /)
  } finally {
    sql(`drop table public.${table}`)
  }
})
