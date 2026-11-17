// A Discord export (DiscordChatExporter's messages.json and media folder) imported with the real
// command. The export here is made up from the tool's documented layout (docs/import.md): nobody
// has seen a real one yet.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { counts, ezeliImport, fresh, freshPeople, fixtures, owner, rows, storedChat, type Names } from './support.ts'

const discord = 'tests/fixtures/discord'
const weekend = `${discord}/weekend`
const timezone = 'Europe/Istanbul'

type Export = { messages: Record<string, any>[]; [key: string]: unknown }

// A copy of the made-up export that a test may change: `change` edits the parsed messages.json.
function changed(change: (file: Export) => void): string {
  const folder = mkdtempSync(join(tmpdir(), 'ezeli-discord-'))
  cpSync(weekend, folder, { recursive: true })
  const file = JSON.parse(readFileSync(join(folder, 'messages.json'), 'utf8')) as Export
  change(file)
  writeFileSync(join(folder, 'messages.json'), JSON.stringify(file))
  return folder
}

function trial(folder: string, ...extra: string[]) {
  return ezeliImport([folder, '--people', `${discord}/people.json`, '--timezone', timezone, '--trial', ...extra])
}

// A people file in which each person is on both chats: WhatsApp names and Discord ids (Fıstık by
// her Discord username). Names and ids are made fresh, as the database is shared by the tests.
function bothChats(names: Names): string {
  const file = join(mkdtempSync(join(tmpdir(), 'ezeli-people-')), 'people.json')
  writeFileSync(
    file,
    JSON.stringify({
      people: [
        { id: names.ids.karpuz, name: names.karpuz, whatsapp: ['Karpuz K'], discord: ['200000000000000001'] },
        { id: names.ids.limon, name: names.limon, whatsapp: ['Limon L', 'Limon 🌻'], discord: ['200000000000000002'] },
        { id: names.ids.fistik, name: names.fistik, whatsapp: ['Fıstık F'], discord: ['fistik.f'] },
        { id: names.ids.cilek, name: names.cilek, whatsapp: ['Çilek Ç'], discord: ['200000000000000004'], leftOut: true },
      ],
    }),
  )
  return file
}

function save(folder: string, chat: string, names: Names, ...extra: string[]) {
  return ezeliImport([folder, '--people', bothChats(names), '--timezone', timezone, '--chat', chat, ...extra])
}

test('a trial run reads the Discord export and saves nothing', () => {
  const result = trial(weekend, '--details')

  expect(result.status).toBe(0)
  expect(result.err).toBe('')
  expect(result.out).toContain('Trial run. Nothing was saved.')
  expect(result.out).toContain('Memories:    2')
  expect(result.out).toContain('Photos:      4')
  expect(result.out).toContain('People:      3 (Fıstık, Karpuz, Limon)')
  expect(result.out).toContain('Date range:  2023-07-14 to 2023-07-15')
  expect(result.out).toContain('Problems:    none')
  // Two memories by the same rules as WhatsApp: three photos and five other lines, then one photo and one message.
  expect(result.out).toContain('2023-07-14 20:58  3 photos, 5 messages  Fıstık, Karpuz, Limon')
  expect(result.out).toContain('2023-07-15 11:05  1 photo, 1 message  Fıstık, Karpuz')
})

test('the conversation holds real messages only: text, photos with their captions, a placeholder line for a video or a voice message', () => {
  const { out } = trial(weekend, '--details')

  // Times are UTC in the export and are shown in the zone given to the import.
  expect(out).toContain('20:50  Karpuz: İskeleye gelin')
  expect(out).toContain('gün batımı çok güzel')
  expect(out).toContain('20:58  Limon: [Photo: IMG_2041.jpg] Bakın')
  expect(out).toContain('21:10  Karpuz: [Photo: kayık.png] hepsi bende')
  expect(out).toContain('Karpuz: [Photo: IMG_2043.jpg]')
  expect(out).toContain('Karpuz: [Video]')
  expect(out).toContain('21:20  Limon: [Voice message]')
  expect(out).toContain('Fıstık: Çok güzel çıkmış! Işık şahane')
  // Skipped: joins and pins, a bot, a left-out sender, a link preview, a forwarded message.
  for (const skipped of ['Joined the server', 'Pinned a message', 'Hatırlatma', 'Ben de çektim', 'example.com', 'eski bir mesaj']) {
    expect(out).not.toContain(skipped)
  }
})

test('dates are shown in the time zone given to the import', () => {
  const { out } = trial(weekend, '--timezone', 'Pacific/Kiritimati')

  // 14 July 17:58 UTC is already the 15th, 07:58 at UTC+14.
  expect(out).toContain('Date range:  2023-07-15 to 2023-07-15')
  expect(out).toContain('2023-07-15 07:58')
})

test('an import saves the chat as a Discord chat, with its memories, messages, photos and people', async () => {
  const chat = fresh('Kaş Sunucusu')
  const names = freshPeople()
  const result = save(weekend, chat, names)

  expect(result.status).toBe(0)
  expect(result.out).toContain(`Saved to the chat "${chat}".`)
  const stored = (await storedChat(chat))!
  expect(stored.app).toBe('discord')
  expect(stored.timezone).toBe(timezone)
  expect(await counts(chat)).toEqual({ memories: 2, messages: 10, photos: 4 })

  const memories = await rows<{ id: string; at: string }>(owner.from('memories').select('id, at').eq('chat_id', stored.id as string).order('at'))
  expect(memories.map((m) => new Date(m.at).toISOString())).toEqual(['2023-07-14T17:58:11.120Z', '2023-07-15T08:05:00.000Z'])
  const messages = await rows<{ text: string; media_kind: string | null }>(owner.from('messages').select('text, media_kind').eq('memory_id', memories[0]!.id).order('at'))
  expect(messages.map((m) => [m.media_kind, m.text])).toEqual([
    [null, 'İskeleye gelin\ngün batımı çok güzel'],
    ['photo', 'Bakın'],
    [null, 'Çok güzel çıkmış! Işık şahane'],
    ['photo', 'hepsi bende'],
    ['photo', ''],
    ['video', ''],
    ['voice', ''],
    [null, 'Yarın tekneye gidiyoruz, unutmayın'],
  ])
  // The left-out sender, the bot and the notices were never stored.
  expect(await rows(owner.from('people').select('id').eq('slug', names.ids.cilek))).toEqual([])
  expect((await rows<{ slug: string }>(owner.from('people').select('slug').in('slug', Object.values(names.ids)))).length).toBe(3)
})

test('importing the same export again adds nothing', async () => {
  const chat = fresh('Kaş Sunucusu')
  const names = freshPeople()
  expect(save(weekend, chat, names).status).toBe(0)
  const before = await counts(chat)
  const keys = async () =>
    (await rows<{ key: string }>(owner.from('messages').select('key, memories!inner(chat_id)').eq('memories.chat_id', (await storedChat(chat))!.id as string))).map((m) => m.key).sort()
  const keysBefore = await keys()

  const again = save(weekend, chat, names)

  expect(again.status).toBe(0)
  expect(await counts(chat)).toEqual(before)
  expect(await keys()).toEqual(keysBefore)
})

test('a newer export adds only what is new, and an edited message is not stored twice', async () => {
  const chat = fresh('Kaş Sunucusu')
  const names = freshPeople()
  expect(save(weekend, chat, names).status).toBe(0)
  expect(await counts(chat)).toEqual({ memories: 2, messages: 10, photos: 4 })

  // Later: the caption of a photo and the text of a message were edited, and a new memory came.
  const newer = changed((file) => {
    const find = (text: string) => file.messages.find((m) => m.content === text)!
    find('Bakın').content = 'Bakın, ne güzel'
    find('İyi geceler').content = 'İyi geceler!'
    const photo = file.messages.find((m) => m.attachments.length === 1 && m.content === '' && m.attachments[0].fileName === 'IMG_3310.jpg')!
    const later = (id: string, timestamp: string, content: string, attachments: unknown[]) => ({ ...photo, id, timestamp, content, attachments })
    file.messages.push(
      later('110000000000000050', '2023-07-16T10:00:00.000+00:00', 'Sabah', [{ ...photo.attachments[0], id: '300000000000000050' }]),
      later('110000000000000051', '2023-07-16T10:01:00.000+00:00', 'Kahvaltı', []),
    )
    file.messageCount = file.messages.length
  })
  cpSync(`${weekend}/media`, join(newer, 'media'), { recursive: true })

  expect(save(newer, chat, names).status).toBe(0)

  expect(await counts(chat)).toEqual({ memories: 3, messages: 12, photos: 5 })
  const texts = (await rows<{ text: string }>(owner.from('messages').select('text, memories!inner(chat_id)').eq('memories.chat_id', (await storedChat(chat))!.id as string))).map((m) => m.text)
  expect(texts).toContain('Bakın, ne güzel')
  expect(texts).not.toContain('Bakın')
})

test('a person who used different names on WhatsApp and Discord is one person in both chats', async () => {
  const names = freshPeople()
  const whatsapp = fresh('Kaş Tatili')
  const server = fresh('Kaş Sunucusu')
  const people = bothChats(names)
  const run = (folder: string, chat: string) => ezeliImport([folder, '--people', people, '--timezone', timezone, '--chat', chat])
  expect(run(`${fixtures}/weekend`, whatsapp).status).toBe(0)
  expect(run(weekend, server).status).toBe(0)

  const person = await rows<{ id: string; display_name: string }>(owner.from('people').select('id, display_name').eq('slug', names.ids.limon))
  expect(person).toEqual([{ id: person[0]!.id, display_name: names.limon }])
  const chatsOfPerson = async () => {
    const sent = await rows<{ memories: any }>(
      owner.from('messages').select('memories!inner(chats!inner(name))').eq('person_id', person[0]!.id),
    )
    return [...new Set(sent.map((m) => m.memories.chats.name))].sort()
  }
  expect(await chatsOfPerson()).toEqual([server, whatsapp].sort())
  expect(await rows(owner.from('people').select('id').eq('display_name', names.limon))).toHaveLength(1)
})

test('a sender who is not in the people file stops the run and is named by Discord name and id', () => {
  const people = join(mkdtempSync(join(tmpdir(), 'ezeli-people-')), 'people.json')
  writeFileSync(people, JSON.stringify({ people: [{ id: 'karpuz', name: 'Karpuz', discord: ['200000000000000001'] }] }))

  const result = ezeliImport([weekend, '--people', people, '--timezone', timezone, '--trial'])

  expect(result.status).toBe(1)
  expect(result.out).toBe('')
  expect(result.err).toContain('fistik.f (200000000000000003)')
  expect(result.err).toContain('limon.l (200000000000000002)')
  expect(result.err).not.toContain('hatirlatici')
})

test('a photo that was not downloaded is missing media, and the rest is imported', () => {
  const folder = changed((file) => {
    const attachment = file.messages.flatMap((m) => m.attachments).find((a: { fileName: string }) => a.fileName === 'IMG_2041.jpg')
    attachment.url = 'https://cdn.discordapp.com/attachments/1/2/IMG_2041.jpg'
  })
  cpSync(`${weekend}/media`, join(folder, 'media'), { recursive: true })

  const result = trial(folder, '--details')

  expect(result.status).toBe(0)
  expect(result.out).toContain('Problems:    1')
  expect(result.out).toContain('Photo missing from the export: IMG_2041.jpg (Limon, 2023-07-14 20:58)')
  expect(result.out).toContain('Photos:      3')
  expect(result.out).toContain('Memories:    2')
  expect(result.out).toContain('[Photo missing from the export] Bakın')
})

test('a file in media that no message attaches (an avatar, an emoji) is not a photo', () => {
  const folder = changed(() => {})
  cpSync(`${weekend}/media/IMG_0007-c4f81a39e06d2b75.jpg`, join(folder, 'media', 'avatar-8d1f3a6c2b9e7045.png'))

  expect(trial(folder).out).toContain('Photos:      4')
})

test.each([
  ['is not JSON', (folder: string) => writeFileSync(join(folder, 'messages.json'), '<html>'), 'is not valid JSON'],
  ['has no list of messages', (folder: string) => writeFileSync(join(folder, 'messages.json'), '{"guild":{}}'), 'has no "messages" list'],
  [
    'has a message without an author id',
    (folder: string) => {
      const file = JSON.parse(readFileSync(join(folder, 'messages.json'), 'utf8')) as Export
      delete file.messages[2]!.author.id
      writeFileSync(join(folder, 'messages.json'), JSON.stringify(file))
    },
    'message 3 (id 110000000000000003) has no "author.id"',
  ],
  [
    'has a time without an offset',
    (folder: string) => {
      const file = JSON.parse(readFileSync(join(folder, 'messages.json'), 'utf8')) as Export
      file.messages[2]!.timestamp = '2023-07-14T17:58:11'
      writeFileSync(join(folder, 'messages.json'), JSON.stringify(file))
    },
    'message 3 (id 110000000000000003) has the time "2023-07-14T17:58:11"',
  ],
  [
    'has an attachment without a file name',
    (folder: string) => {
      const file = JSON.parse(readFileSync(join(folder, 'messages.json'), 'utf8')) as Export
      delete file.messages[2]!.attachments[0].fileName
      writeFileSync(join(folder, 'messages.json'), JSON.stringify(file))
    },
    'message 3 (id 110000000000000003) has an attachment without a "fileName"',
  ],
])('a messages.json that %s stops the run with a plain message', (_name, damage, message) => {
  const folder = changed(() => {})
  damage(folder)

  const result = trial(folder)

  expect(result.status).toBe(1)
  expect(result.out).toBe('')
  expect(result.err).toContain(message)
  expect(result.err).toContain('docs/import.md')
  expect(result.err).not.toMatch(/\n\s+at /)
})

test('a folder with neither a WhatsApp nor a Discord export stops the run', () => {
  const empty = mkdtempSync(join(tmpdir(), 'ezeli-empty-'))
  mkdirSync(join(empty, 'media'))

  const result = trial(empty)

  expect(result.status).toBe(1)
  expect(result.err).toContain('No _chat.txt in')
  expect(result.err).toContain('messages.json')
})
