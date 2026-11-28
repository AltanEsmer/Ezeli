// A Discord export (DiscordChatExporter's messages.json and media folder) imported with the real
// command. The export here is made up from the tool's documented layout (docs/import.md): nobody
// has seen a real one yet.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { makeClipExport } from '../clip-export.ts'
import { counts, ezeli, ezeliImport, fresh, freshPeople, fixtures, owner, rows, storedChat, type Names } from './support.ts'

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

// A people file in which each person is on both chats: WhatsApp names and Discord account ids. Names and ids are made fresh, as the database is shared by the tests.
function bothChats(names: Names): string {
  const file = join(mkdtempSync(join(tmpdir(), 'ezeli-people-')), 'people.json')
  writeFileSync(
    file,
    JSON.stringify({
      people: [
        { id: names.ids.karpuz, name: names.karpuz, whatsapp: ['Karpuz K'], discord: ['200000000000000001'] },
        { id: names.ids.limon, name: names.limon, whatsapp: ['Limon L', 'Limon 🌻'], discord: ['200000000000000002'] },
        { id: names.ids.fistik, name: names.fistik, whatsapp: ['Fıstık F'], discord: ['200000000000000003'] },
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

test('a sender who is not in the people file stops the run and is named by server name, username and id', () => {
  const people = join(mkdtempSync(join(tmpdir(), 'ezeli-people-')), 'people.json')
  writeFileSync(people, JSON.stringify({ people: [{ id: 'karpuz', name: 'Karpuz', discord: ['200000000000000001'] }] }))

  const result = ezeliImport([weekend, '--people', people, '--timezone', timezone, '--trial'])

  expect(result.status).toBe(1)
  expect(result.out).toBe('')
  expect(result.err).toContain('Fıstık / fistik.f (200000000000000003)')
  expect(result.err).toContain('Limon 🌻 / limon.l (200000000000000002)')
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

// A Discord name in the people file never joins a sender: names are not unique and they change.
test('an account that only shares a server nickname with a person is not that person', () => {
  const people = join(mkdtempSync(join(tmpdir(), 'ezeli-people-')), 'people.json')
  writeFileSync(
    people,
    JSON.stringify({
      people: [
        { id: 'karpuz', name: 'Karpuz', discord: ['200000000000000001', 'Karpuz', 'karpuz.k'] },
        { id: 'limon', name: 'Limon', discord: ['200000000000000002'] },
        { id: 'fistik', name: 'Fıstık', discord: ['Fıstık', 'fistik.f'] },
      ],
    }),
  )

  const result = ezeliImport([weekend, '--people', people, '--timezone', timezone, '--trial'])

  expect(result.status).toBe(1)
  expect(result.err).toContain('Fıstık / fistik.f (200000000000000003)')
})

// Mentions: the export gives each mentioned account with its id.
function mentioning(text: string, ...who: { id: string; name: string; nickname: string }[]) {
  const folder = changed((file) => {
    const sample = file.messages[0]!
    file.messages.push({ ...sample, id: '110000000000000060', timestamp: '2023-07-14T18:00:00.000+00:00', content: text, mentions: who, attachments: [] })
    file.messageCount = file.messages.length
  })
  return folder
}
const cilek = { id: '200000000000000004', name: 'cilek.c', nickname: 'Çilek' }
const limon = { id: '200000000000000002', name: 'limon.l', nickname: 'Limon 🌻' }
const stranger = { id: '200000000000000088', name: 'muz.m', nickname: 'Muz' }

test('a mention shows the person under their Ezeli name, and a left-out or unknown person is removed from the text', () => {
  const folder = mentioning('@Çilek geliyor musun? @Limon 🌻 sen? @Muz da gelsin. @Limon🌻x', cilek, limon, stranger)

  const { status, out } = trial(folder, '--details')

  expect(status).toBe(0)
  expect(out).toContain('Karpuz: geliyor musun? @Limon sen? da gelsin. @Limon🌻x')
  for (const name of ['Çilek', 'Muz']) expect(out).not.toContain(name)
})

test('the name of a left-out person reaches the database through no mention', async () => {
  const chat = fresh('Kaş Sunucusu')
  const names = freshPeople()
  const folder = mentioning('@Çilek geliyor musun? @Limon 🌻 sen?', cilek, limon)
  expect(save(folder, chat, names).status).toBe(0)

  const stored = await rows<{ text: string }>(owner.from('messages').select('text, memories!inner(chat_id)').eq('memories.chat_id', (await storedChat(chat))!.id as string))
  expect(stored.map((m) => m.text)).toContain(`geliyor musun? @${names.limon} sen?`)
  expect(stored.some((m) => m.text.includes('Çilek'))).toBe(false)
})

test.each([
  ['an export with no messages', { messages: [] }, 'has no messages'],
  [
    'an export where every message is empty (Message Content Intent off)',
    null,
    'Message Content Intent',
  ],
])('%s stops the run and stores nothing', async (_name, content, message) => {
  const folder = changed((file) => {
    if (content) file.messages = content.messages
    else for (const m of file.messages) (m.content = ''), (m.attachments = [])
  })
  const chat = fresh('Kaş Sunucusu')

  const result = save(folder, chat, freshPeople())

  expect(result.status).toBe(1)
  expect(result.out).toBe('')
  expect(result.err).toContain(message)
  expect(await storedChat(chat)).toBeUndefined()
})

test('a file that does not match the layout stops a saving run and stores nothing', async () => {
  const folder = changed((file) => {
    delete file.messages[12]!.author.id
  })
  const chat = fresh('Kaş Sunucusu')

  const result = save(folder, chat, freshPeople())

  expect(result.status).toBe(1)
  expect(result.err).toContain('message 13')
  expect(await storedChat(chat)).toBeUndefined()
})

test('a "type" that is a number says the export is in Discord\'s own format', () => {
  const folder = changed((file) => {
    file.messages[2]!.type = 0
  })

  const result = trial(folder)

  expect(result.status).toBe(1)
  expect(result.err).toContain('message 3 (id 110000000000000003) has a "type" that is a number (0)')
})

test.each([
  ['../outside.jpg'],
  ['media/../../outside.jpg'],
  ['%2e%2e/outside.jpg'],
  ['..%2foutside.jpg'],
  [join(tmpdir(), 'ezeli-outside', 'outside.jpg')],
  ['file:///etc/hosts.jpg'],
])('an attachment path that leaves the export folder (%s) is not read', (url) => {
  const folder = changed((file) => {
    file.messages[2]!.attachments[0].url = url
  })
  const parent = join(folder, '..')
  cpSync(`${weekend}/media/IMG_2041-3f9a1c0b7e2d4a61.jpg`, join(parent, 'outside.jpg'))
  mkdirSync(join(tmpdir(), 'ezeli-outside'), { recursive: true })
  cpSync(`${weekend}/media/IMG_2041-3f9a1c0b7e2d4a61.jpg`, join(tmpdir(), 'ezeli-outside', 'outside.jpg'))
  cpSync(`${weekend}/media`, join(folder, 'media'), { recursive: true })

  const result = trial(folder)

  expect(result.out).toContain('Photo missing from the export: IMG_2041.jpg')
  expect(result.out).toContain('Photos:      3')
})

test.each([
  ['an escaped space and Turkish letters', 'media/k%C4%B1%C5%9F%20rotas%C4%B1-ab12cd34ef567890.jpg'],
  ['unescaped Turkish letters and a space', 'media/kış rotası-ab12cd34ef567890.jpg'],
])('an attachment file name with %s is found', (_name, url) => {
  const folder = changed((file) => {
    Object.assign(file.messages[2]!.attachments[0], { url, fileName: 'kış rotası.jpg' })
  })
  cpSync(`${weekend}/media`, join(folder, 'media'), { recursive: true })
  cpSync(`${weekend}/media/IMG_2041-3f9a1c0b7e2d4a61.jpg`, join(folder, 'media', 'kış rotası-ab12cd34ef567890.jpg'))

  const result = trial(folder)

  expect(result.out).toContain('Problems:    none')
  expect(result.out).toContain('Photos:      4')
})

test.each([
  ['no fraction', '2023-07-14T17:58:11+00:00'],
  ['a short fraction', '2023-07-14T17:58:11.5+00:00'],
  ['seven digits of fraction', '2023-07-14T17:58:11.1234567+00:00'],
  ['a Z', '2023-07-14T17:58:11Z'],
  ['an offset of +03:00', '2023-07-14T20:58:11+03:00'],
])('a time with %s is read as the same moment', (_name, time) => {
  const folder = changed((file) => {
    file.messages[2]!.timestamp = time
  })

  const result = trial(folder, '--details')

  expect(result.status).toBe(0)
  expect(result.out).toContain('2023-07-14 20:58  3 photos')
  expect(result.out).toContain('20:58  Limon: [Photo: IMG_2041.jpg] Bakın')
})

test('a hidden legacy Discord text stays hidden when it becomes a video caption', async () => {
  const caption = 'Fictional caption to keep hidden'
  const folder = changed((file) => {
    file.messages[0]!.content = caption
  })
  const chat = fresh('Discord hidden caption')
  const names = freshPeople()
  try {
    const imported = save(folder, chat, names)
    expect(imported.status, imported.err).toBe(0)
    const stored = (await storedChat(chat))!
    const [memory] = await rows<{ key: string; id: string }>(owner.from('memories').select('key, id').eq('chat_id', stored.id as string).order('at'))
    const listed = ezeli(['memory', memory!.key])
    const code = listed.out.split('\n').find((line) => line.includes(caption))?.split(/\s+/)[0]
    expect(code).toBeTruthy()
    const hidden = ezeli(['hide', memory!.key, code!, '--yes'])
    expect(hidden.status, hidden.err).toBe(0)

    const path = join(folder, 'messages.json')
    const file = JSON.parse(readFileSync(path, 'utf8')) as Export
    file.messages[0]!.attachments = [{ id: '500000000000000099', fileName: 'sketch.mp4', url: 'media/sketch.mp4' }]
    writeFileSync(path, JSON.stringify(file))
    const reimported = save(folder, chat, names)
    expect(reimported.status, reimported.err).toBe(0)
    const messages = await rows<{ text: string; media_kind: string | null }>(
      owner.from('messages').select('text, media_kind').eq('memory_id', memory!.id).order('at'),
    )
    expect(messages[0]).toEqual({ text: '', media_kind: 'video' })
    expect(messages.map((message) => message.text)).not.toContain(caption)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('hiding a missing Discord clip preserves a playable sibling from the same minute', async () => {
  const chat = fresh('Discord clip placeholders')
  const names = freshPeople()
  const media = await makeClipExport()
  const folder = changed((file) => {
    for (const message of file.messages) message.attachments = message.attachments.filter((item: { fileName: string }) => !item.fileName.endsWith('.mp4'))
    file.messages[0]!.attachments = [
      { id: '500000000000000097', fileName: 'missing.mp4', url: 'media/missing.mp4' },
      { id: '500000000000000098', fileName: 'kept.mp4', url: 'media/kept.mp4' },
    ]
  })
  try {
    cpSync(media.first, join(folder, 'media', 'kept.mp4'))
    const imported = save(folder, chat, names)
    expect(imported.status, imported.err).toBe(0)
    const stored = (await storedChat(chat))!
    const [memory] = await rows<{ key: string; id: string }>(owner.from('memories').select('key, id').eq('chat_id', stored.id as string).order('at'))
    const videos = () => rows<{ key: string; clip_path: string | null }>(
      owner.from('messages').select('key, clip_path').eq('memory_id', memory!.id).eq('media_kind', 'video').order('seq'),
    )
    const before = await videos()
    expect(before).toHaveLength(2)
    const missing = before.find((row) => !row.clip_path)
    const kept = before.find((row) => row.clip_path)
    expect(kept).toBeDefined()
    expect(missing).toBeDefined()
    const hidden = ezeli(['hide', memory!.key, missing!.key.slice(0, 8), '--yes'])
    expect(hidden.status, hidden.err).toBe(0)
    expect(await videos()).toEqual([kept])
    const repeated = save(folder, chat, names)
    expect(repeated.status, repeated.err).toBe(0)
    expect(await videos()).toEqual([kept])
  } finally {
    rmSync(folder, { recursive: true, force: true })
    rmSync(media.dir, { recursive: true, force: true })
  }
}, 60_000)
