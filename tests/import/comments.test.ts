// Who may do what with comments, asked of the database directly with a friend's token, another
// friend's token, an owner's token and no token. Comments follow the sign-in pattern: every rule
// asks private.current_person_id(), so a person whose session is gone can do nothing at once.
import { createClient } from '@supabase/supabase-js'
import { spawnSync } from 'node:child_process'
import { beforeAll, expect, test } from 'vitest'
import { fresh, freshPeople, importChat, owner, rows, signedInAs, stack, storedChat, visitor } from './support.ts'

let memory: string

beforeAll(async () => {
  const chat = fresh('Kaş Tatili')
  expect(importChat(chat).status).toBe(0)
  memory = (await rows<{ id: string }>(owner.from('memories').select('id').eq('chat_id', (await storedChat(chat))!.id as string)))[0]!.id
})

async function ownerOf(name: string) {
  const result = spawnSync('node', ['cli/ezeli.ts', 'person', 'add', '--name', name, '--owner'], {
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_URL: stack.apiUrl, SUPABASE_SECRET_KEY: stack.secretKey, EZELI_APP_URL: stack.appUrl },
  })
  const link = result.stdout.match(/#k=([0-9a-f]{16})\.([0-9a-f]{64})/)!
  const client = createClient(stack.apiUrl, stack.publishableKey, { auth: { persistSession: false } })
  expect((await client.auth.signInWithPassword({ email: `${link[1]}@ezeli.invalid`, password: link[2]! })).error).toBeNull()
  return client
}

const stored = (id: string) => rows<{ id: string; body: string; person_id: string }>(owner.from('comments').select('id, body, person_id').eq('id', id))
const add = (client: Awaited<ReturnType<typeof signedInAs>>, body: string) => client.from('comments').insert({ memory_id: memory, body }).select('id, person_id, created_at').single()

test('a signed-in person adds a comment as themselves, and everyone signed in reads it', async () => {
  const name = fresh('Limon')
  const friend = await signedInAs(name)
  const other = await signedInAs(fresh('Karpuz'))

  const added = await add(friend, 'Bu günü hiç unutmam')

  expect(added.error).toBeNull()
  const me = (await friend.rpc('current_person')).data![0]!
  expect(added.data!.person_id).toBe(me.id)
  expect(Date.now() - Date.parse(added.data!.created_at)).toBeLessThan(60_000)
  const seen = await other.from('comments').select('body, people(display_name)').eq('id', added.data!.id)
  expect(seen.data).toEqual([{ body: 'Bu günü hiç unutmam', people: { display_name: name } }])
})

test('a person cannot write a comment as someone else, or choose its time', async () => {
  const friend = await signedInAs(fresh('Limon'))
  const other = await signedInAs(fresh('Karpuz'))
  const otherId = (await other.rpc('current_person')).data![0]!.id

  const forged = await friend.from('comments').insert({ memory_id: memory, body: 'sahte', person_id: otherId })
  const dated = await friend.from('comments').insert({ memory_id: memory, body: 'eski', created_at: '2020-01-01T00:00:00Z' })

  expect(forged.error).not.toBeNull()
  expect(dated.error).not.toBeNull()
  expect(await rows(owner.from('comments').select('id').in('body', ['sahte', 'eski']))).toEqual([])
})

test('only plain trimmed text of a sensible length is stored', async () => {
  const friend = await signedInAs(fresh('Limon'))

  for (const bad of ['', '   ', '\n\n', ' kenarda boşluk', 'sonda satır\n', 'x'.repeat(2001)]) {
    expect((await add(friend, bad)).error, JSON.stringify(bad.slice(0, 20))).not.toBeNull()
  }
  const long = await add(friend, 'x'.repeat(2000))
  expect(long.error).toBeNull()
  const lines = await add(friend, 'ilk satır\n\nüçüncü <b>satır</b>')
  expect((await stored(lines.data!.id))[0]!.body).toBe('ilk satır\n\nüçüncü <b>satır</b>')
})

test('nobody edits a comment, not even its writer or an owner', async () => {
  const friend = await signedInAs(fresh('Limon'))
  const boss = await ownerOf(fresh('Sahip'))
  const added = await add(friend, 'ilk hali')

  for (const client of [friend, boss]) {
    await client.from('comments').update({ body: 'değişti' }).eq('id', added.data!.id)
  }

  expect((await stored(added.data!.id))[0]!.body).toBe('ilk hali')
})

test('a person deletes their own comment and no one else\'s', async () => {
  const friend = await signedInAs(fresh('Limon'))
  const other = await signedInAs(fresh('Karpuz'))
  const mine = await add(friend, 'benim')
  const theirs = await add(other, 'onun')

  await friend.from('comments').delete().eq('id', theirs.data!.id)
  expect(await stored(theirs.data!.id)).toHaveLength(1)

  const deleted = await friend.from('comments').delete().eq('id', mine.data!.id).select('id')
  expect(deleted.data).toHaveLength(1)
  expect(await stored(mine.data!.id)).toEqual([])
})

test('an owner deletes any comment', async () => {
  const friend = await signedInAs(fresh('Limon'))
  const boss = await ownerOf(fresh('Sahip'))
  const added = await add(friend, 'silinecek')

  const deleted = await boss.from('comments').delete().eq('id', added.data!.id).select('id')

  expect(deleted.data).toHaveLength(1)
  expect(await stored(added.data!.id)).toEqual([])
})

test('a visitor reads, adds and deletes nothing', async () => {
  const friend = await signedInAs(fresh('Limon'))
  const added = await add(friend, 'sadece arkadaşlar')
  const guest = visitor()

  expect((await guest.from('comments').select('*')).data ?? []).toEqual([])
  expect((await guest.from('comments').insert({ memory_id: memory, body: 'ziyaretçi' })).error).not.toBeNull()
  await guest.from('comments').delete().eq('id', added.data!.id)
  expect(await stored(added.data!.id)).toHaveLength(1)
  expect(await rows(owner.from('comments').select('id').eq('body', 'ziyaretçi'))).toEqual([])
})

test('a person whose link was replaced can do nothing with comments at once', async () => {
  const name = fresh('Limon')
  const friend = await signedInAs(name)
  const added = await add(friend, 'eski bağlantı')
  const replaced = spawnSync('node', ['cli/ezeli.ts', 'person', 'relink', '--name', name], {
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_URL: stack.apiUrl, SUPABASE_SECRET_KEY: stack.secretKey, EZELI_APP_URL: stack.appUrl },
  })
  expect(replaced.status).toBe(0)

  expect((await friend.from('comments').select('*')).data ?? []).toEqual([])
  expect((await add(friend, 'hâlâ yazıyorum')).error).not.toBeNull()
  await friend.from('comments').delete().eq('id', added.data!.id)
  expect(await stored(added.data!.id)).toHaveLength(1)
})

test('comments survive a regroup: a comment on a memory that disappears moves to the memory that now holds its first photo', async () => {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  importChat(chat, { people })
  const chatId = (await storedChat(chat))!.id as string
  const memoriesOf = () => rows<{ id: string; key: string }>(owner.from('memories').select('id, key').eq('chat_id', chatId))
  const original = await memoriesOf()

  // A small photo gap splits the first memory in two: the new one starts at the second photo.
  expect(importChat(chat, { people, extra: ['--photo-gap', '5'] }).status).toBe(0)
  const split = (await memoriesOf()).find((m) => !original.some((o) => o.key === m.key))!
  const friend = await signedInAs(fresh('Limon'))
  const written = await friend.from('comments').insert({ memory_id: split.id, body: 'Bu kare başka bir anıya ait' }).select('id').single()
  expect(written.error).toBeNull()

  // The starting numbers join them again: the new memory disappears.
  const joined = importChat(chat, { people })

  expect(joined.status).toBe(0)
  expect(joined.out).toMatch(/Removed:\s+1 memory, 0 messages, 0 photos/)
  expect(await memoriesOf()).toHaveLength(original.length)
  // The new memory was keyed by its first photo's message; that message says where it is now.
  const now = await rows<{ memory_id: string }>(owner.from('messages').select('memory_id').eq('key', split.key))
  const comment = await rows<{ memory_id: string; body: string }>(owner.from('comments').select('memory_id, body').eq('id', written.data!.id))
  expect(comment).toEqual([{ memory_id: now[0]!.memory_id, body: 'Bu kare başka bir anıya ait' }])
  expect(comment[0]!.memory_id).not.toBe(split.id)
})

test('a comment stays where it is when the same export is imported again', async () => {
  const chat = fresh('Kaş Tatili')
  const people = freshPeople()
  importChat(chat, { people })
  const memory = (await rows<{ id: string }>(owner.from('memories').select('id').eq('chat_id', (await storedChat(chat))!.id as string)))[0]!.id
  const friend = await signedInAs(fresh('Limon'))
  const written = await friend.from('comments').insert({ memory_id: memory, body: 'yerinde' }).select('id').single()

  expect(importChat(chat, { people }).status).toBe(0)

  expect(await rows(owner.from('comments').select('memory_id').eq('id', written.data!.id))).toEqual([{ memory_id: memory }])
})
