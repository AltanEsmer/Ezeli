import { expect, test } from 'vitest'
import { fresh, importChat, owner, rows, storedChat } from './support.ts'

type Memory = { id: string; key: string; at: string; chat_id: string }
type Message = { key: string; at: string; text: string; media_kind: string | null; person_id: string; memory_id: string; seq: number }

async function storedMemories(chatId: string) {
  return rows<Memory>(owner.from('memories').select('*').eq('chat_id', chatId).order('at'))
}

test('an import without trial stores the chat and its memories', async () => {
  const chat = fresh('Kaş Tatili')
  const result = importChat(chat)

  expect(result.err).toBe('')
  expect(result.status).toBe(0)
  expect(result.out).toContain('Saved')

  const stored = await storedChat(chat)
  expect(stored).toMatchObject({ name: chat, app: 'whatsapp', timezone: 'Europe/Istanbul' })
  expect(await storedMemories(stored!.id as string)).toHaveLength(2)
})

test('a memory is dated by the time its first photo was sent, read in the time zone of the import', async () => {
  const chat = fresh('Kaş Tatili')
  importChat(chat)

  const memories = await storedMemories((await storedChat(chat))!.id as string)
  // 20:58:11 and 11:05:00 on a phone in Istanbul (UTC+3 in July 2023).
  expect(memories.map((memory) => new Date(memory.at).toISOString())).toEqual([
    '2023-07-14T17:58:11.000Z',
    '2023-07-15T08:05:00.000Z',
  ])
})

test('only the messages that belong to a memory are stored, by display name, in order, with a placeholder for media', async () => {
  const chat = fresh('Kaş Tatili')
  const { people } = importChat(chat)

  const [first] = await storedMemories((await storedChat(chat))!.id as string)
  const messages = await rows<Message & { people: { display_name: string } }>(
    owner.from('messages').select('*, people(display_name)').eq('memory_id', first!.id).order('at').order('seq'),
  )

  // Not stored: the 19:05 message before the memory, the joined and left notices, the sticker, the
  // deleted message, the later night message, and everything the left-out sender wrote.
  expect(messages.map((m) => [m.people.display_name, m.media_kind, m.text])).toEqual([
    [people.fistik, null, 'Ben geldim bile 😎'],
    [people.karpuz, null, 'İskeleye gelin\ngün batımı çok güzel\n\nşarj aletini unutmayın'],
    [people.limon, 'photo', ''],
    [people.fistik, null, 'Çok güzel çıkmış! Işık şahane'],
    [people.karpuz, 'photo', ''],
    [people.fistik, 'video', ''],
    [people.karpuz, 'voice', ''],
    [people.fistik, 'document', ''],
    [people.limon, null, 'Yarın tekneye gidiyoruz, unutmayın'],
  ])
  const all = await rows<{ text: string }>(owner.from('messages').select('text').in('memory_id', (await storedMemories((await storedChat(chat))!.id as string)).map((m) => m.id)))
  expect(all.map((m) => m.text).join('\n')).not.toContain('Yola çıktık')
})
