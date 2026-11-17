// What a chat already has stored, and what an import takes away when it no longer fits. An import
// of an export says, for the time the export covers, what the chat looked like then. Inside that
// time, stored messages that are not in the import (other grouping numbers, a sender left out
// since, an edited text) are removed, and so are memories whose first photo no longer starts one.
// Outside that time nothing is touched, so an older export never undoes a newer one.
import type { Db } from '../supabase.ts'

export type StoredMemory = { id: string; key: string; at: string }
export type StoredMessage = { id: string; key: string; at: string; memory_id: string }
export type StoredPhoto = { key: string; view_path: string; thumb_path: string; width: number; height: number }
export type Stored = { memories: StoredMemory[]; messages: StoredMessage[]; photos: StoredPhoto[] }
export type Span = { from: number; to: number } // moments, in milliseconds, both included
export type Kept = { memories: Set<string>; messages: Set<string> } // the keys of this import
export type Counts = { memories: number; messages: number; photos: number }

const PAGE = 1000
const CHUNK = 200

export const nothingStored: Stored = { memories: [], messages: [], photos: [] }

export async function loadStored(db: Db, chatId: string): Promise<Stored> {
  return {
    memories: await pages<StoredMemory>((from, to) => db.from('memories').select('id, key, at').eq('chat_id', chatId).order('key').range(from, to)),
    messages: await pages<StoredMessage>((from, to) =>
      db.from('messages').select('id, key, at, memory_id, memories!inner(chat_id)').eq('memories.chat_id', chatId).order('key').range(from, to),
    ),
    photos: await pages<StoredPhoto>((from, to) =>
      db.from('photos').select('key, view_path, thumb_path, width, height, memories!inner(chat_id)').eq('memories.chat_id', chatId).order('key').range(from, to),
    ),
  }
}

// What follows a memory that disappears when it is regrouped. A memory that disappears is
// replaced by the memory that now holds its first photo, and whatever people attached to it moves
// there. Comments (issue 18) and hidden marks (issue 20) each add one line here, naming their
// table and how it points at a memory: by `id` (a `memory_id` column) or by `key` (the memory's
// lasting key, as a hidden mark keeps it). Nothing else changes.
export const followsMemory: { table: string; column: string; by: 'id' | 'key' }[] = []

// Where a memory that goes away has gone: the memory that now holds its first photo. The memory's
// key is the key of that photo's message, so the message says where it is now.
type Folded = { from: StoredMemory; to: { id: string; key: string } }

export async function removeWhatNoLongerFits(db: Db, stored: Stored, kept: Kept, span: Span | undefined): Promise<Counts> {
  const removed: Counts = { memories: 0, messages: 0, photos: 0 }
  if (!span) return removed
  const inSpan = (at: string) => new Date(at).getTime() >= span.from && new Date(at).getTime() <= span.to

  const messages = stored.messages.filter((message) => inSpan(message.at) && !kept.messages.has(message.key))
  const photos = stored.photos.filter((photo) => messages.some((message) => message.key === photo.key))
  const paths = photos.flatMap((photo) => [photo.view_path, photo.thumb_path])
  for (const part of chunks(paths)) {
    const gone = await db.storage.from('photos').remove(part)
    if (gone.error) throw gone.error
  }
  for (const part of chunks(messages.map((message) => message.id))) {
    const deleted = await db.from('messages').delete().in('id', part)
    if (deleted.error) throw deleted.error
  }
  removed.messages = messages.length
  removed.photos = photos.length

  // Memories whose first photo no longer starts one. Their photos and messages that are still
  // stored were moved into the memories of this import when those were saved; whatever is left
  // (it lies outside the time of this export) goes to the memory that holds the first photo.
  const gone = stored.memories.filter((memory) => inSpan(memory.at) && !kept.memories.has(memory.key))
  const folded = await whereTheyWent(db, gone)
  for (const { from, to } of folded) {
    for (const table of ['messages', 'photos']) {
      const moved = await db.from(table).update({ memory_id: to.id }).eq('memory_id', from.id)
      if (moved.error) throw moved.error
    }
    for (const { table, column, by } of followsMemory) {
      const moved = await db.from(table).update({ [column]: by === 'id' ? to.id : to.key }).eq(column, by === 'id' ? from.id : from.key)
      if (moved.error) throw moved.error
    }
  }
  // A memory with nothing of this import to go to and still holding messages stays as it is.
  const still = new Set<string>()
  for (const part of chunks(gone.map((memory) => memory.id))) {
    const left = await db.from('messages').select('memory_id').in('memory_id', part)
    if (left.error) throw left.error
    for (const row of left.data) still.add(row.memory_id)
  }
  const deletable = gone.filter((memory) => !still.has(memory.id))
  for (const part of chunks(deletable.map((memory) => memory.id))) {
    const deleted = await db.from('memories').delete().in('id', part)
    if (deleted.error) throw deleted.error
  }
  removed.memories = deletable.length
  return removed
}

async function whereTheyWent(db: Db, gone: StoredMemory[]): Promise<Folded[]> {
  const folded: Folded[] = []
  for (const part of chunks(gone)) {
    const found = await db.from('messages').select('key, memory_id, memories!inner(key)').in('key', part.map((memory) => memory.key))
    if (found.error) throw found.error
    for (const row of found.data as unknown as { key: string; memory_id: string; memories: { key: string } }[]) {
      const from = part.find((memory) => memory.key === row.key)!
      if (row.memory_id !== from.id) folded.push({ from, to: { id: row.memory_id, key: row.memories.key } })
    }
  }
  return folded
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
