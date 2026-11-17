// Saving: the two sizes of each photo, then the chat, its people, the memories, messages and
// photos. Everything is written by key, so the same export saved twice leaves one copy, and an
// import that stopped halfway is finished by running it again.
import type { Db } from '../supabase.ts'
import { hasPhotoFile, isPhoto, type Memory, type MemoryMessage } from './memories.ts'
import type { ChatApp } from './people.ts'
import { makeSizes } from './photos.ts'
import { Stop } from './stop.ts'

export type ChatToSave = { key: string; name: string; app: ChatApp; timezone: string }

const BUCKET = 'photos'
const CHUNK = 200

export async function saveChat(db: Db, chat: ChatToSave, memories: Memory[]): Promise<void> {
  const messages = memories.flatMap((memory) => memory.messages)

  // The time zone is fixed at the chat's first import: the dates of what is stored were made
  // with it. Checked before anything is written.
  const existing = await db.from('chats').select('timezone').eq('key', chat.key).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data && existing.data.timezone !== chat.timezone) {
    throw new Stop(
      `This chat was first imported with the time zone ${existing.data.timezone}, not ${chat.timezone}. ` +
        `Import it again with --timezone ${existing.data.timezone}; nothing was changed.`,
    )
  }

  // Photos first, so that a photo row exists only when both its files are in the bucket.
  const sizes = new Map<string, { view: string; thumb: string; width: number; height: number }>()
  await mapLimit(messages.filter(hasPhotoFile), 4, async (message) => {
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

  const savedChat = await db.from('chats').upsert(chat, { onConflict: 'key' }).select('id').single()
  if (savedChat.error) throw savedChat.error
  const chatId = savedChat.data.id

  const people = await savePeople(db, messages)

  // A memory is known by its first photo message, whether or not its file was there.
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
    person_id: people.get(message.personId)!,
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
      person_id: people.get(message.personId)!,
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

// People are matched by the fixed id of the people file, saved as `people.slug`. With no row for
// the id, a row with the same display name and no id yet (made earlier by `person add`) is
// adopted; otherwise a row is created, without an account. A changed display name updates the
// row. Returns the row id of each person id.
async function savePeople(db: Db, messages: MemoryMessage[]): Promise<Map<string, string>> {
  const wanted = new Map(messages.map((message) => [message.personId, message.person]))
  const rowIds = new Map<string, string>()
  for (const [slug, name] of wanted) {
    const bySlug = await db.from('people').select('id, display_name').eq('slug', slug).maybeSingle()
    if (bySlug.error) throw bySlug.error
    if (bySlug.data) {
      if (bySlug.data.display_name !== name) {
        const renamed = await db.from('people').update({ display_name: name }).eq('id', bySlug.data.id)
        if (renamed.error?.code === '23505') {
          throw new Stop(`Cannot rename "${bySlug.data.display_name}" to "${name}": another person already has that name.`)
        }
        if (renamed.error) throw renamed.error
      }
      rowIds.set(slug, bySlug.data.id)
      continue
    }
    const byName = await db.from('people').select('id, slug').eq('display_name', name).maybeSingle()
    if (byName.error) throw byName.error
    if (byName.data?.slug) {
      throw new Stop(`The name "${name}" already belongs to a person with the id "${byName.data.slug}", not "${slug}".`)
    }
    if (byName.data) {
      const adopted = await db.from('people').update({ slug }).eq('id', byName.data.id)
      if (adopted.error) throw adopted.error
      rowIds.set(slug, byName.data.id)
      continue
    }
    const created = await db.from('people').insert({ display_name: name, slug }).select('id').single()
    if (created.error) throw created.error
    rowIds.set(slug, created.data.id)
  }
  return rowIds
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
