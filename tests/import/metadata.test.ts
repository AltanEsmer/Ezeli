import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, test } from 'vitest'
import { copyOfWeekend, fresh, importChat, owner, rows, storedChat } from './support.ts'

test('stored photos carry no metadata: no location, no camera', async () => {
  const folder = copyOfWeekend()
  const withMetadata = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3d5a80' } })
    .withExif({
      IFD0: { Make: 'MadeUpCamera', Model: 'Model 1' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 1/1 1/1', GPSLongitudeRef: 'E', GPSLongitude: '29/1 0/1 0/1' },
    })
    .jpeg()
    .toBuffer()
  // The made-up original really has the metadata.
  expect((await sharp(withMetadata).metadata()).exif).toBeDefined()
  expect(withMetadata.includes('MadeUpCamera')).toBe(true)
  writeFileSync(join(folder, '00000007-PHOTO-2023-07-14-20-58-11.jpg'), withMetadata)

  const chat = fresh('Kaş Tatili')
  expect(importChat(chat, { folder }).status).toBe(0)

  const memories = await rows<{ id: string }>(owner.from('memories').select('id').eq('chat_id', (await storedChat(chat))!.id as string))
  const photos = await rows<{ view_path: string; thumb_path: string; width: number }>(
    owner.from('photos').select('*').in('memory_id', memories.map((m) => m.id)).eq('width', 800),
  )
  expect(photos).toHaveLength(1)
  for (const path of [photos[0]!.view_path, photos[0]!.thumb_path]) {
    const stored = await owner.storage.from('photos').download(path)
    const bytes = Buffer.from(await stored.data!.arrayBuffer())
    const metadata = await sharp(bytes).metadata()
    expect(metadata.exif).toBeUndefined()
    expect(metadata.xmp).toBeUndefined()
    expect(metadata.icc).toBeUndefined()
    expect(bytes.includes('MadeUpCamera')).toBe(false)
    expect(bytes.includes('GPS')).toBe(false)
  }
})
