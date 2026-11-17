// Who may read what the import stored, and that nobody can change it from the app.
import { beforeAll, expect, test } from 'vitest'
import { fresh, importChat, owner, rows, signedInAs, stack, storedChat, visitor } from './support.ts'

const tables = ['chats', 'memories', 'messages', 'photos', 'timeline'] as const
let thumb: string

beforeAll(async () => {
  const chat = fresh('Kaş Tatili')
  expect(importChat(chat).status).toBe(0)
  const memories = await rows<{ id: string }>(owner.from('memories').select('id').eq('chat_id', (await storedChat(chat))!.id as string))
  const photos = await rows<{ thumb_path: string }>(owner.from('photos').select('thumb_path').eq('memory_id', memories[0]!.id))
  thumb = photos[0]!.thumb_path
})

test('a visitor without a session reads nothing from any table or from the bucket', async () => {
  const guest = visitor()
  for (const table of tables) {
    const read = await guest.from(table).select('*')
    expect(read.data ?? [], table).toEqual([])
  }
  expect((await guest.storage.from('photos').createSignedUrl(thumb, 60)).data).toBeNull()
  expect((await guest.storage.from('photos').download(thumb)).data).toBeNull()
  expect((await guest.storage.from('photos').list()).data ?? []).toEqual([])
  // The bucket is private: the public address of a file does not open it either.
  const direct = await fetch(`${stack.apiUrl}/storage/v1/object/public/photos/${thumb}`)
  expect(direct.ok).toBe(false)
})

test('a signed-in person reads memories, messages and photos, and the photos through short-lived links', async () => {
  const friend = await signedInAs(fresh('Limon'))

  for (const table of tables) {
    const read = await friend.from(table).select('*')
    expect(read.error, table).toBeNull()
    expect(read.data!.length, table).toBeGreaterThan(0)
  }

  const link = await friend.storage.from('photos').createSignedUrl(thumb, 3600)
  expect(link.error).toBeNull()
  const picture = await fetch(link.data!.signedUrl)
  expect(picture.status).toBe(200)
  expect(picture.headers.get('content-type')).toBe('image/webp')
  // A link that was cut short opens nothing.
  const cut = await fetch(link.data!.signedUrl.replace(/token=.{10}/, 'token=xxxxxxxxxx'))
  expect(cut.ok).toBe(false)
})

test('nobody can change anything from the app, not even a signed-in person', async () => {
  const friend = await signedInAs(fresh('Limon'))
  const [memory] = await rows<{ id: string; chat_id: string }>(owner.from('memories').select('id, chat_id').limit(1))

  // Other tests import at the same time, so only the rows tried here are compared.
  for (const table of ['chats', 'memories', 'messages', 'photos'] as const) {
    const [row] = await rows(owner.from(table).select('*').limit(1))
    const added = await friend.from(table).insert({ key: 'x', name: 'x', app: 'whatsapp', timezone: 'UTC', chat_id: memory!.chat_id, at: new Date().toISOString() })
    expect(added.error, `insert ${table}`).not.toBeNull()
    await friend.from(table).update({ at: '2000-01-01T00:00:00Z', name: 'changed' }).eq('id', row!.id as string)
    await friend.from(table).delete().eq('id', row!.id as string)
    expect(await rows(owner.from(table).select('*').eq('id', row!.id as string)), table).toEqual([row])
  }

  const upload = await friend.storage.from('photos').upload(`${fresh('own')}.webp`, new Blob(['x'], { type: 'image/webp' }))
  expect(upload.error).not.toBeNull()
  const removed = await friend.storage.from('photos').remove([thumb])
  expect(removed.data ?? []).toEqual([])
  expect((await owner.storage.from('photos').download(thumb)).error).toBeNull()
})
