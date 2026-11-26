import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, test } from 'vitest'
import { copyOfWeekend, fresh, importChat, owner, rows, storedChat } from './support.ts'

test('import stores reliable capture GPS separately from metadata-free images', async () => {
  const folder = copyOfWeekend()
  const withMetadata = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3d5a80' } })
    .withExif({
      IFD0: { Make: 'MadeUpCamera', Model: 'Model 1' },
      IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '41/1 1/1 1/1', GPSLongitudeRef: 'E', GPSLongitude: '29/1 0/1 0/1' },
    })
    .jpeg()
    .toBuffer()
  // The made-up original really has the metadata.
  expect((await sharp(withMetadata).metadata()).exif).toBeDefined()
  expect(withMetadata.includes('MadeUpCamera')).toBe(true)
  writeFileSync(join(folder, '00000007-PHOTO-2023-07-14-20-58-11.jpg'), withMetadata)

  const badGps = await sharp({ create: { width: 799, height: 600, channels: 3, background: '#706543' } })
    .withExif({
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '91/1 0/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '29/1 0/1 0/1' },
    })
    .jpeg()
    .toBuffer()
  writeFileSync(join(folder, '00000009-PHOTO-2023-07-14-21-10-05.jpg'), badGps)

  const chat = fresh('Kaş Tatili')
  expect(importChat(chat, { folder }).status).toBe(0)

  const memories = await rows<{ id: string }>(owner.from('memories').select('id').eq('chat_id', (await storedChat(chat))!.id as string))
  const photos = await rows<{ view_path: string; thumb_path: string; width: number; latitude: number | null; longitude: number | null }>(
    owner.from('photos').select('*').in('memory_id', memories.map((m) => m.id)),
  )
  expect(photos).toHaveLength(3)
  const located = photos.find((photo) => photo.width === 800)!
  expect(located.latitude).toBeCloseTo(-41.01694444, 6)
  expect(located.longitude).toBe(29)
  expect(photos.filter((photo) => photo.width !== 800)).toEqual([
    expect.objectContaining({ latitude: null, longitude: null }),
    expect.objectContaining({ latitude: null, longitude: null }),
  ])
  for (const path of [located.view_path, located.thumb_path]) {
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
