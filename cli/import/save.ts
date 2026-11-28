// Saving: the two sizes of each photo, then the chat, its people, the memories, messages and
// photos. Everything is written by key, so the same export saved twice leaves one copy, and an
// import that stopped halfway is finished by running it again.
import { existsSync, writeFileSync } from 'node:fs'
import type { Db } from '../supabase.ts'
import { buildMemories, hasPhotoFile, isPhoto, type Grouping, type MemoryMessage } from './memories.ts'
import type { ChatApp } from './people.ts'
import { makeSizes } from './photos.ts'
import { applyMarks } from './marks.ts'
import { chunks, loadStored, nothingStored, removeFilesWithoutRow, removeWhatNoLongerFits, storedOutside, type Counts, type Removed, type Span } from './regroup.ts'
import { Stop } from './stop.ts'

export type ChatToSave = { key: string; name: string; app: ChatApp; timezone: string }

const BUCKET = 'photos'

// What a saving run did, in rows: new ones, ones that were already stored, ones taken away.
export type SaveReport = { added: Counts; already: Counts; removed: Removed }

// `exported` are the export's messages in chat order, left-out senders removed. `span` is the
// time the export covers. What is stored outside that time is joined with the export before the
// grouping (see regroup.ts), so a memory cut by the edge of the export stays whole.
export async function saveChat(db: Db, chat: ChatToSave, exported: MemoryMessage[], grouping: Grouping, span: Span | undefined): Promise<SaveReport> {
  const startedAt = Date.now()
  // The time zone is fixed at the chat's first import: the dates of what is stored were made
  // with it. Checked before anything is written.
  const existing = await db.from('chats').select('id, timezone').eq('key', chat.key).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data && existing.data.timezone !== chat.timezone) {
    throw new Stop(
      `This chat was first imported with the time zone ${existing.data.timezone}, not ${chat.timezone}. ` +
        `Import it again with --timezone ${existing.data.timezone}; nothing was changed.`,
    )
  }

  // What an owner hid is removed from what is stored before anything is read from it (marks.ts).
  await applyMarks(db, chat.key)
  const stored = existing.data ? await loadStored(db, existing.data.id) : nothingStored
  const storedPhotos = new Map(stored.photos.map((photo) => [photo.key, photo]))
  const outside = storedOutside(stored, span)
  // A stored message that this export holds again is the export's: the same chat from another phone
  // has other seconds, so a message stored at 20:58:11 may lie outside an export that has minutes only.
  const again = new Set(exported.map((message) => message.key))
  const notAgain = (message: MemoryMessage) => !again.has(message.key)
  const memories = buildMemories([...outside.before.filter(notAgain), ...exported, ...outside.after.filter(notAgain)], grouping)
  const messages = memories.flatMap((memory) => memory.messages)

  const savedChat = await db.from('chats').upsert(chat, { onConflict: 'key' }).select('id').single()
  if (savedChat.error) throw savedChat.error
  const chatId = savedChat.data.id

  // Photos first, so that a photo row exists only when both its files are in the bucket.
  const sizes = new Map<string, { view: string; thumb: string; width: number; height: number; hash: string | null }>()
  await mapLimit(messages.filter(hasPhotoFile), 4, async (message) => {
    // Already stored with both files: nothing to convert or upload again.
    const there = storedPhotos.get(message.key)
    if (there) {
      sizes.set(message.key, { view: there.view_path, thumb: there.thumb_path, width: there.width, height: there.height, hash: message.media?.hash ?? there.content_hash })
      return
    }
    const file = message.media!.file!
    let made
    try {
      made = await makeSizes(file)
    } catch (error) {
      throw new Stop(`Could not convert the photo ${message.media!.name ?? file}: ${(error as Error).message}`)
    }
    const view = `${chatId}/${message.key}-view.webp`
    const thumb = `${chatId}/${message.key}-thumb.webp`
    for (const [path, body] of [[view, made.view], [thumb, made.thumb]] as const) {
      const uploaded = await db.storage.from(BUCKET).upload(path, body, { contentType: 'image/webp', upsert: true })
      if (uploaded.error) throw uploaded.error
    }
    sizes.set(message.key, { view, thumb, width: made.width, height: made.height, hash: message.media?.hash ?? null })
  })

  // People of the export are saved (and renamed) from the export; the others are known by their rows.
  const people = await savePeople(db, exported)
  for (const row of stored.messages) if (!people.has(row.people.slug)) people.set(row.people.slug, row.people.id)

  await testPause()

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

  // A photo message with a stored row keeps its row (and gets the memory the regroup gives it)
  // even when this export has no file for it.
  const photoRows = placed.filter(({ message }) => sizes.has(message.key) || storedPhotos.has(message.key)).map(({ message, seq, memory }) => {
    const existingPhoto = storedPhotos.get(message.key)
    const size = sizes.get(message.key) ?? (({ view_path, thumb_path, width, height, content_hash }) => ({ view: view_path, thumb: thumb_path, width, height, hash: message.media?.hash ?? content_hash }))(existingPhoto!)
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
      content_hash: size.hash,
    }
  })
  for (const part of chunks(photoRows)) {
    const saved = await db.from('photos').upsert(part, { onConflict: 'key' })
    if (saved.error) throw saved.error
  }

  // A later export may have GPS that the first one lacked. The regular upsert never
  // writes coordinates, and a conditional update keeps the first point across retries
  // and concurrent imports.
  await mapLimit(messages.filter(hasPhotoFile), 4, async ({ key, media }) => {
    const location = media?.location
    if (!location || storedPhotos.get(key)?.latitude != null) return
    const saved = await db.from('photos').update(location).eq('key', key).is('latitude', null)
    if (saved.error) throw saved.error
  })

  // Only now, with every row of this import in place, is anything that no longer fits removed.
  const kept = { memories: new Set(memoryRows.map((row) => row.key)), messages: new Set(messages.map((message) => message.key)) }
  const removed = await removeWhatNoLongerFits(db, stored, kept)
  // Files that no row points at, left by a run that stopped while removing them.
  await removeFilesWithoutRow(db, chatId, startedAt)
  // Once more at the very end: a hide that landed while this import ran (which may have written a
  // hidden photo's row again from what was read at the start) is put right here.
  const late = await applyMarks(db, chat.key)
  removed.memories += late.memories
  removed.messages += late.messages
  removed.photos += late.photos
  removed.comments += late.comments
  const had = {
    memories: stored.memories.filter((memory) => kept.memories.has(memory.key)).length,
    messages: stored.messages.filter((message) => kept.messages.has(message.key)).length,
    photos: photoRows.filter((photo) => storedPhotos.has(photo.key)).length,
  }
  const now = { memories: kept.memories.size, messages: kept.messages.size, photos: photoRows.length }
  return {
    added: { memories: now.memories - had.memories, messages: now.messages - had.messages, photos: now.photos - had.photos },
    already: had,
    removed,
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

// A seam for a test only: with EZELI_TEST_PAUSE set, the import stops here until `<value>.go` exists
// (and says so by writing `<value>.ready`), so a test can run an owner command in the middle of it.
async function testPause(): Promise<void> {
  const base = process.env.EZELI_TEST_PAUSE
  if (!base) return
  writeFileSync(`${base}.ready`, '')
  while (!existsSync(`${base}.go`)) await new Promise((resolve) => setTimeout(resolve, 50))
}

// Runs `work` on every item, a few at a time. Stops at the first failure.
async function mapLimit<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!)
  })
  await Promise.all(runners)
}
