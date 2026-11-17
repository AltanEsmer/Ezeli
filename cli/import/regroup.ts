// What a chat already has stored, and what an import takes away when it no longer fits.
//
// The rule: inside the time an export covers, the export is the truth; outside it, what is stored
// is the truth. So before grouping, the export's messages are joined with the stored messages that
// lie outside that time, and the joined list is grouped. A memory cut by the edge of an export
// stays whole. Stored messages are removed only when they lie inside the export's time and the
// export no longer holds them, or when the regroup leaves them in no memory.
//
// Only messages inside memories were ever stored. A regroup with bigger numbers (a longer window
// before or after the photos) can only use what is stored, so for the full effect import the
// full export.
import type { Media, MediaKind } from './chat.ts'
import type { MemoryMessage } from './memories.ts'
import { Stop } from './stop.ts'
import type { Db } from '../supabase.ts'

export type StoredMemory = { id: string; key: string; at: string }
export type StoredMessage = {
  id: string
  key: string
  at: string
  seq: number
  memory_id: string
  text: string
  media_kind: MediaKind | null
  people: { id: string; slug: string; display_name: string }
}
export type StoredPhoto = { key: string; view_path: string; thumb_path: string; width: number; height: number }
export type Stored = { memories: StoredMemory[]; messages: StoredMessage[]; photos: StoredPhoto[] }
export type Span = { from: number; to: number } // moments, in milliseconds, both included
export type Kept = { memories: Set<string>; messages: Set<string> } // the keys of this import
export type Counts = { memories: number; messages: number; photos: number }
// What a saving run removed also counts the comments that went with a memory with no photo left.
export type Removed = Counts & { comments: number }

const PAGE = 1000
const CHUNK = 200
const BUCKET = 'photos'

export const nothingStored: Stored = { memories: [], messages: [], photos: [] }

// The time an export covers: from its first message to its last, whoever sent them. A loop, not
// `Math.min(...)`: a long chat has more messages than a call can take as arguments.
export function spanOf(moments: Iterable<number>): Span | undefined {
  let from = Infinity
  let to = -Infinity
  for (const moment of moments) {
    if (moment < from) from = moment
    if (moment > to) to = moment
  }
  return from <= to ? { from, to } : undefined
}

export async function loadStored(db: Db, chatId: string): Promise<Stored> {
  return {
    memories: await pages<StoredMemory>((from, to) => db.from('memories').select('id, key, at').eq('chat_id', chatId).order('key').range(from, to)),
    messages: await pages<StoredMessage>((from, to) =>
      db
        .from('messages')
        .select('id, key, at, seq, memory_id, text, media_kind, people(id, slug, display_name), memories!inner(chat_id)')
        .eq('memories.chat_id', chatId)
        .order('key')
        .range(from, to),
    ),
    photos: await loadPhotos(db, chatId),
  }
}

function loadPhotos(db: Db, chatId: string) {
  return pages<StoredPhoto>((from, to) =>
    db.from('photos').select('key, view_path, thumb_path, width, height, memories!inner(chat_id)').eq('memories.chat_id', chatId).order('key').range(from, to),
  )
}

// The stored messages outside the time of the export, in chat order, as the grouping reads them.
// A photo whose row is stored counts as a photo with its file (`file` is only a marker: the files
// are in the bucket already).
export function storedOutside(stored: Stored, span: Span | undefined): { before: MemoryMessage[]; after: MemoryMessage[] } {
  const photos = new Set(stored.photos.map((photo) => photo.key))
  const sorted = [...stored.messages].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.seq - b.seq)
  const before: MemoryMessage[] = []
  const after: MemoryMessage[] = []
  for (const row of sorted) {
    const at = new Date(row.at).getTime()
    if (span && at >= span.from && at <= span.to) continue
    const message: MemoryMessage = { key: row.key, at, person: row.people.display_name, personId: row.people.slug, text: row.text }
    if (row.media_kind) {
      const media: Media = { kind: row.media_kind }
      if (photos.has(row.key)) media.file = 'stored'
      message.media = media
    }
    ;(span && at > span.to ? after : before).push(message)
  }
  return { before, after }
}

// What follows a memory that disappears when it is regrouped. Rows attached to it move to the
// memory that now holds its first photo; if that photo is gone, to the memory that now holds the
// earliest of its remaining photos; only if none of its photos remain do they go with it.
//
// A table that points at memories is listed here, and its column must be `on delete restrict`, so
// that a table that is not listed stops the import with its name instead of losing rows. Hidden
// marks (issue 20) do not point at memories: they mark photos and messages by their lasting keys,
// so the regroup owes them nothing.
export const followsMemory: { table: string; column: string }[] = [{ table: 'comments', column: 'memory_id' }]

export async function removeWhatNoLongerFits(db: Db, stored: Stored, kept: Kept): Promise<Removed> {
  // Rows first, then files: a leftover file is harmless, a photo row without its files is broken.
  const messages = stored.messages.filter((message) => !kept.messages.has(message.key))
  const gonePhotos = stored.photos.filter((photo) => messages.some((message) => message.key === photo.key))
  for (const part of chunks(messages.map((message) => message.id))) {
    const deleted = await db.from('messages').delete().in('id', part)
    if (deleted.error) throw deleted.error
  }
  await removeFiles(db, gonePhotos.flatMap((photo) => [photo.view_path, photo.thumb_path]))

  const gone = stored.memories.filter((memory) => !kept.memories.has(memory.key))
  const heirs = await whereTheyWent(db, stored, kept, gone)
  for (const [from, to] of heirs) {
    for (const { table, column } of followsMemory) {
      const moved = await db.from(table).update({ [column]: to }).eq(column, from)
      if (moved.error) throw moved.error
    }
  }
  // A memory with no photo left has no heir: what is attached to it goes with it, on purpose, and
  // is counted so the summary can say so. Before the memory, which `restrict` would otherwise keep.
  let comments = 0
  const homeless = gone.filter((memory) => !heirs.has(memory.id)).map((memory) => memory.id)
  for (const part of chunks(homeless)) {
    for (const { table, column } of followsMemory) {
      const removed = await db.from(table).delete({ count: 'exact' }).in(column, part)
      if (removed.error) throw removed.error
      if (table === 'comments') comments += removed.count ?? 0
    }
  }
  for (const part of chunks(gone.map((memory) => memory.id))) {
    const deleted = await db.from('memories').delete().in('id', part)
    const table = deleted.error?.code === '23503' && /constraint "[^"]+" on table "([^"]+)"/.exec(deleted.error.message)?.[1]
    if (table && !followsMemory.some((entry) => entry.table === table)) {
      throw new Stop(
        `The table "${table}" points at memories but is not in followsMemory (cli/import/regroup.ts), so a memory that disappears cannot be removed. ` +
          'Add it there and run the same import again; it finishes the job.',
      )
    }
    if (deleted.error) throw deleted.error
  }
  return { memories: gone.length, messages: messages.length, photos: gonePhotos.length, comments }
}

// For each memory that goes: the id of the memory that now holds its first photo, or the
// earliest of its remaining photos. A memory with no photo left has no heir.
async function whereTheyWent(db: Db, stored: Stored, kept: Kept, gone: StoredMemory[]): Promise<Map<string, string>> {
  const candidates = new Map<string, string[]>()
  for (const memory of gone) {
    const photos = stored.messages
      .filter((m) => m.memory_id === memory.id && m.media_kind === 'photo' && kept.messages.has(m.key))
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.seq - b.seq)
    candidates.set(memory.id, photos.map((m) => m.key))
  }
  const now = new Map<string, string>()
  for (const part of chunks([...candidates.values()].flat())) {
    const found = await db.from('messages').select('key, memory_id').in('key', part)
    if (found.error) throw found.error
    for (const row of found.data) now.set(row.key, row.memory_id)
  }
  const heirs = new Map<string, string>()
  for (const [memory, keys] of candidates) {
    const heir = keys.map((key) => now.get(key)).find((id) => id && id !== memory)
    if (heir) heirs.set(memory, heir)
  }
  return heirs
}

async function removeFiles(db: Db, paths: string[]): Promise<void> {
  for (const part of chunks(paths)) {
    const removed = await db.storage.from(BUCKET).remove(part)
    if (removed.error) throw filesStop(removed.error)
  }
}

// Files in the chat's folder of the bucket that no photo row points at: left by a run that
// stopped while removing them. Run at the end of a saving run, when every row of the run is in
// place. Other chats' folders are never looked at.
export async function removeFilesWithoutRow(db: Db, chatId: string): Promise<void> {
  const known = new Set<string>()
  for (const photo of await loadPhotos(db, chatId)) {
    known.add(photo.view_path)
    known.add(photo.thumb_path)
  }
  const orphans: string[] = []
  for (let offset = 0; ; offset += PAGE) {
    const listed = await db.storage.from(BUCKET).list(chatId, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (listed.error) throw listed.error
    for (const file of listed.data) if (file.id && !known.has(`${chatId}/${file.name}`)) orphans.push(`${chatId}/${file.name}`)
    if (listed.data.length < PAGE) break
  }
  await removeFiles(db, orphans)
}

function filesStop(error: { message?: string }) {
  const reason = (error.message ?? String(error)).replace(/\s+/g, ' ')
  return new Stop(`The rows are removed but some photo files could not be: ${reason}. Run the same import again; it removes files that have no row.`)
}

async function pages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw error
    all.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) return all
  }
}

export function chunks<T>(items: T[]): T[][] {
  const parts: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) parts.push(items.slice(i, i + CHUNK))
  return parts
}
