import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, test } from 'vitest'
import { copyOfWeekend, fresh, freshPeople, importChat, owner, rows, signedInAs, storedChat } from './support.ts'

test('repeat import locates an existing photo once and preserves its memory and comment', async () => {
  const folder = copyOfWeekend()
  try {
    const chat = fresh('Island walk')
    const people = freshPeople()
    const run = (extra: string[] = []) => {
      const result = importChat(chat, { folder, people, extra })
      expect(result.status, result.err).toBe(0)
    }
    const path = join(folder, '00000007-PHOTO-2023-07-14-20-58-11.jpg')
    const bytes = readFileSync(path)
    const addGps = (degrees: number) => sharp(bytes).withExif({
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: `${degrees}/1 10/1 0/1`, GPSLongitudeRef: 'E', GPSLongitude: '33/1 21/1 0/1' },
    }).jpeg().toFile(path)

    run()
    const readMemories = async () => rows<{ id: string; key: string }>(owner.from('memories')
      .select('id, key, at').eq('chat_id', (await storedChat(chat))!.id).order('at'))
    const memories = await readMemories()
    const memoryIds = memories.map(({ id }) => id)
    const readPhotos = () => rows(owner.from('photos')
      .select('id, key, message_id, memory_id, at, seq, view_path, thumb_path')
      .in('memory_id', memoryIds).order('at'))
    const photos = await readPhotos()
    const friend = await signedInAs(fresh('Plum'))
    const comments = () => rows(friend.from('comments').select('id, body').eq('memory_id', memoryIds[0]!))
    const posted = await friend.from('comments').insert({ memory_id: memoryIds[0]!, body: 'I remember this walk.' }).select('id, body').single()
    expect(posted.error).toBeNull()
    const pins = () => rows(friend.from('located_photos').select('latitude, longitude, message_id, memory_key, thumb_path')
      .in('message_id', photos.map((photo) => photo.message_id)))
    expect(await pins()).toEqual([])

    rmSync(path)
    run()
    expect(await pins()).toEqual([])
    await addGps(93)
    run()
    expect(await pins()).toEqual([])
    await addGps(35)
    run(['--trial'])
    expect(await pins()).toEqual([])

    run()
    run()
    const recovered = {
      latitude: expect.closeTo(35.16666667, 8), longitude: 33.35, message_id: photos[0]!.message_id,
      memory_key: memories[0]!.key, thumb_path: photos[0]!.thumb_path,
    }
    expect(await pins()).toEqual([recovered])

    await addGps(36)
    run()
    rmSync(path)
    run()
    expect(await pins()).toEqual([recovered])
    expect(await readMemories()).toEqual(memories)
    expect(await readPhotos()).toEqual(photos)
    expect(await comments()).toEqual([posted.data])
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
