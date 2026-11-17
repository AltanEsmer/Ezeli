// Saving WhatsApp exports of different layouts: the real command runs on made-up exports and the
// result is read from the running local Supabase (database and bucket).
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, test } from 'vitest'
import { makeExport, variantPeople, variants } from './exports.ts'
import { counts, ezeliImport, fresh, owner, rows, storedChat } from './support.ts'

// The made-up people file of the variants, with names and ids no other test uses.
function variantPeopleFile(tag: string): string {
  const { people } = JSON.parse(readFileSync(variantPeople, 'utf8')) as { people: { id: string; name: string }[] }
  const file = join(tmpdir(), `ezeli-people-${tag.replace(/\s/g, '-')}.json`)
  writeFileSync(file, JSON.stringify({ people: people.map((p) => ({ ...p, id: `${p.id}-${tag.replace(/\s/g, '-')}`, name: `${p.name} ${tag}` })) }))
  return file
}

function save(folder: string, chat: string, people: string) {
  return ezeliImport([folder, '--people', people, '--timezone', 'Europe/Istanbul', '--chat', chat])
}

async function storedKeys(chatName: string): Promise<string[]> {
  const chat = (await storedChat(chatName))!
  const memories = await rows<{ id: string }>(owner.from('memories').select('id').eq('chat_id', chat.id as string))
  const messages = await rows<{ key: string }>(owner.from('messages').select('key').in('memory_id', memories.map((m) => m.id)))
  return messages.map((m) => m.key).sort()
}

test('the same chat exported from an iPhone and from an Android phone is stored once', async () => {
  const iphone = [
    '[28.07.2019 18:02:11] Karpuz K: selam',
    '[3.08.2019 09:15:02] Karpuz K: Günaydın',
    '‎[3.08.2019 09:16:30] Limon L: ‎<attached: 00000005-PHOTO-2019-08-03-09-16-30.jpg>',
    'Göl kenarı',
    '[3.08.2019 09:16:41] Limon L: tamam',
    '[3.08.2019 09:22:31] Fıstık F: tamam',
    '[3.08.2019 09:22:45] Fıstık F: tamam',
    '',
  ].join('\r\n')
  const android = [
    '7/28/19, 6:02 PM - Karpuz: selam',
    '8/3/19, 9:15 AM - Karpuz: Günaydın',
    '8/3/19, 9:16 AM - Limon: IMG-20190803-WA0004.jpg (file attached)',
    'Göl kenarı',
    '8/3/19, 9:16 AM - Limon: tamam',
    '8/3/19, 9:22 AM - Fıstık: tamam',
    '8/3/19, 9:22 AM - Fıstık: tamam',
    '',
  ].join('\n')
  const fromIphone = await makeExport(iphone, { photos: ['00000005-PHOTO-2019-08-03-09-16-30.jpg'] })
  const fromAndroid = await makeExport(android, { android: true, photos: ['IMG-20190803-WA0004.jpg'] })
  const chat = fresh('Kamp Ekibi')
  const people = variantPeopleFile(fresh('t'))

  expect(save(fromIphone, chat, people).status).toBe(0)
  const before = await counts(chat)
  const keysBefore = await storedKeys(chat)
  expect(before).toEqual({ memories: 1, messages: 5, photos: 1 })

  const second = save(fromAndroid, chat, people)

  expect(second.status).toBe(0)
  expect(await counts(chat)).toEqual(before)
  expect(await storedKeys(chat)).toEqual(keysBefore)
})

test('an iPhone export is saved with its HEIC photo converted, and no phone number is stored', async () => {
  const chat = fresh('Kamp Ekibi')
  const tag = fresh('t')

  const result = save(`${variants}/iphone-turkish`, chat, variantPeopleFile(tag))

  expect(result.status).toBe(0)
  expect(result.out).not.toContain('could not be read')
  const stored = (await storedChat(chat))!
  const memories = await rows<{ id: string }>(owner.from('memories').select('id').eq('chat_id', stored.id as string))
  const ids = memories.map((m) => m.id)
  const photos = await rows<{ view_path: string; thumb_path: string; width: number; height: number }>(
    owner.from('photos').select('*').in('memory_id', ids).order('at'),
  )
  expect(photos).toHaveLength(3)
  const heic = photos.at(-1)!
  expect([heic.width, heic.height]).toEqual([64, 48])
  for (const path of [heic.view_path, heic.thumb_path]) {
    const file = await owner.storage.from('photos').download(path)
    if (file.error) throw file.error
    expect((await sharp(Buffer.from(await file.data.arrayBuffer())).metadata()).format).toBe('webp')
  }

  // Nowhere is a phone number: not in a message, not as a person.
  const texts = (await rows<{ text: string }>(owner.from('messages').select('text').in('memory_id', ids))).map((m) => m.text).join('\n')
  expect(texts).toContain(`@Fıstık ${tag} odunları`)
  expect(texts).not.toMatch(/\+90|0532|500 000|5000000/)
  const named = await rows<{ display_name: string }>(owner.from('people').select('display_name').like('display_name', `%${tag}`))
  expect(named.map((p) => p.display_name).join('\n')).not.toMatch(/\d{5}/)
})

test('an Android export is saved: files found, media without a kind kept as a placeholder, numbers replaced', async () => {
  const chat = fresh('Kamp Ekibi')
  const tag = fresh('t')

  const result = save(`${variants}/android-english`, chat, variantPeopleFile(tag))

  expect(result.status).toBe(0)
  const stored = (await storedChat(chat))!
  const memories = await rows<{ id: string }>(owner.from('memories').select('id').eq('chat_id', stored.id as string))
  const messages = await rows<{ text: string; media_kind: string | null }>(
    owner.from('messages').select('text, media_kind').in('memory_id', memories.map((m) => m.id)).order('at'),
  )
  expect(messages.map((m) => m.media_kind)).toEqual([null, 'photo', 'document', 'video', 'voice', null, null, null, 'document'])
  const mention = messages.find((m) => m.text.startsWith('@'))!
  expect(mention.text).toBe(`@İncir ${tag} odunları unutma, sen de gel`)
  expect(messages.map((m) => m.text).join('\n')).not.toMatch(/9050000|\+90/)
})
