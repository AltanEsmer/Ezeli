// Saving: the chat, its people, the two sizes of each photo, then the memories, messages and
// photos. Everything is written by key, so the same export saved twice leaves one copy.
import type { Db } from '../supabase.ts'
import { isPhoto, type Memory } from './memories.ts'
import type { ChatApp } from './people.ts'
import { makeSizes } from './photos.ts'
import { Stop } from './stop.ts'

export type ChatToSave = { key: string; name: string; app: ChatApp; timezone: string }

const BUCKET = 'photos'
const CHUNK = 200

export async function saveChat(db: Db, chat: ChatToSave, memories: Memory[]): Promise<void> {
  const messages = memories.flatMap((memory) => memory.messages)

  const savedChat = await db.from('chats').upsert(chat, { onConflict: 'key' }).select('id').single()
  if (savedChat.error) throw savedChat.error
  const chatId = savedChat.data.id

  // People are matched by display name. Those that do not exist yet are created without an
  // account: `person add` gives them a link later.
  const names = [...new Set(messages.map((message) => message.person))]
  const created = await db.from('people').upsert(names.map((display_name) => ({ display_name })), { onConflict: 'display_name', ignoreDuplicates: true })
  if (created.error) throw created.error
  const people = new Map<string, string>()
  const found = await db.from('people').select('id, display_name').in('display_name', names)
  if (found.error) throw found.error
  for (const row of found.data) people.set(row.display_name, row.id)

  // Photos first: if one cannot be made, nothing has been written to the tables yet.
  const sizes = new Map<string, { view: string; thumb: string; width: number; height: number }>()
  const photos = messages.filter(isPhoto)
  await mapLimit(photos, 4, async (message) => {
    const file = message.media!.file!
    let made
    try {
      made = await makeSizes(file)
    } catch (error) {
      throw new Stop(`Could not convert the photo ${message.media!.name ?? file}: ${(error as Error).message}`)
    }
    const view = `${message.key}-view.webp`
    const thumb = `${message.key}-thumb.webp`
    for (const [path, body] of [[view, made.view], [thumb, made.thumb]] as const) {
      const uploaded = await db.storage.from(BUCKET).upload(path, body, { contentType: 'image/webp', upsert: true })
      if (uploaded.error) throw uploaded.error
    }
    sizes.set(message.key, { view, thumb, width: made.width, height: made.height })
  })

  // A memory is known by its first photo.
  const memoryRows = memories.map((memory) => ({
    chat_id: chatId,
    key: memory.messages.find(isPhoto)!.key,
    at: new Date(memory.at).toISOString(),
  }))
  const memoryIds = new Map<string, string>()
  for (const part of chunks(memoryRows)) {
    const saved = await db.from('memories').upsert(part, { onConflict: 'key' }).select('id, key')
    if (saved.error) throw saved.error
    for (const row of saved.data) memoryIds.set(row.key, row.id)
  }

  const placed = memories.flatMap((memory, index) =>
    memory.messages.map((message, seq) => ({ message, seq, memory: memoryIds.get(memoryRows[index]!.key)! })),
  )
  const messageRows = placed.map(({ message, seq, memory }) => ({
    memory_id: memory,
    key: message.key,
    person_id: people.get(message.person)!,
    at: new Date(message.at).toISOString(),
    seq,
    text: message.text,
    media_kind: message.media?.kind ?? null,
  }))
  const messageIds = new Map<string, string>()
  for (const part of chunks(messageRows)) {
    const saved = await db.from('messages').upsert(part, { onConflict: 'key' }).select('id, key')
    if (saved.error) throw saved.error
    for (const row of saved.data) messageIds.set(row.key, row.id)
  }

  const photoRows = placed.filter(({ message }) => sizes.has(message.key)).map(({ message, seq, memory }) => {
    const size = sizes.get(message.key)!
    return {
      memory_id: memory,
      message_id: messageIds.get(message.key)!,
      key: message.key,
      person_id: people.get(message.person)!,
      at: new Date(message.at).toISOString(),
      seq,
      view_path: size.view,
      thumb_path: size.thumb,
      width: size.width,
      height: size.height,
    }
  })
  for (const part of chunks(photoRows)) {
    const saved = await db.from('photos').upsert(part, { onConflict: 'key' })
    if (saved.error) throw saved.error
  }
}

function chunks<T>(items: T[]): T[][] {
  const parts: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) parts.push(items.slice(i, i + CHUNK))
  return parts
}

// Runs `work` on every item, a few at a time. Stops at the first failure.
async function mapLimit<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!)
  })
  await Promise.all(runners)
}

