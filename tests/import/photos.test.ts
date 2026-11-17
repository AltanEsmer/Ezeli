import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, test } from 'vitest'
import { copyOfWeekend, fresh, importChat, owner, rows, storedChat } from './support.ts'

type Photo = { view_path: string; thumb_path: string; width: number; height: number; key: string }

async function storedPhotos(chatName: string): Promise<Photo[]> {
  const chat = (await storedChat(chatName))!
  const memories = await rows<{ id: string }>(owner.from('memories').select('id').eq('chat_id', chat.id as string))
  return rows<Photo>(owner.from('photos').select('*').in('memory_id', memories.map((m) => m.id)).order('at'))
}

async function look(path: string) {
  const file = await owner.storage.from('photos').download(path)
  if (file.error) throw file.error
  const bytes = Buffer.from(await file.data.arrayBuffer())
  const { format, width, height } = await sharp(bytes).metadata()
  return { format, width, height, bytes: bytes.length }
}

test('each photo is stored in two sizes, and the original is not uploaded', async () => {
  const folder = copyOfWeekend()
  // A made-up photo the size a phone makes: 4000 x 3000 pixels.
  const original = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#d9a441' } }).jpeg().toBuffer()
  writeFileSync(join(folder, '00000007-PHOTO-2023-07-14-20-58-11.jpg'), original)

  const chat = fresh('Kaş Tatili')
  expect(importChat(chat, { folder }).status).toBe(0)

  const photos = await storedPhotos(chat)
  expect(photos).toHaveLength(3)
  const [big, small] = photos

  const view = await look(big!.view_path)
  const thumb = await look(big!.thumb_path)
  expect(view).toMatchObject({ format: 'webp', width: 1600, height: 1200 })
  expect(thumb).toMatchObject({ format: 'webp', width: 720, height: 540 })
  expect([big!.width, big!.height]).toEqual([1600, 1200])
  // Smaller than the original, which is what an owner's storage plan needs.
  expect(view.bytes).toBeLessThan(original.length)

  // A photo that is already small is not blown up.
  expect(await look(small!.view_path)).toMatchObject({ width: 16, height: 16 })

  // The chat's folder in the bucket holds exactly these two files for the photo, and no original.
  const chatId = big!.view_path.split('/')[0]!
  const listed = await owner.storage.from('photos').list(chatId, { limit: 1000, search: big!.key })
  expect(listed.data?.map((file) => file.name).sort()).toEqual([`${big!.key}-thumb.webp`, `${big!.key}-view.webp`])
})

test('a photo that cannot be read is reported as a problem and the rest is imported', async () => {
  const folder = copyOfWeekend()
  // Not a picture at all: how an iPhone format this build cannot read looks to it.
  writeFileSync(join(folder, '00000009-PHOTO-2023-07-14-21-10-05.jpg'), 'this is not a picture')

  const chat = fresh('Kaş Tatili')
  const result = importChat(chat, { folder })

  expect(result.status).toBe(0)
  expect(result.err).toBe('')
  expect(result.out).toMatch(/Problems:\s+1\n\s+- Photo could not be read: 00000009-PHOTO-2023-07-14-21-10-05\.jpg \(.+, 2023-07-14 21:10\)/)
  expect(await storedPhotos(chat)).toHaveLength(2)
})
