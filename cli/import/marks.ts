// Hiding (issue 20): what an owner hid is remembered as a mark in the table `hidden`, and one step,
// `applyMarks`, removes what the marks match. The import leaves matching things out before it groups
// and runs the same step at its very end; the owner command `hide` writes marks and runs it.
//
// A mark names the chat, the person, the clock minute, the kind (photo, text, other media) and what
// to match: a photo's file hash, a text message's text, nothing for other media. Rule, the same
// wherever it is used: among that person's things of that kind in that minute, the ones that match
// exactly are hidden; if none matches (the file was re-saved, the text edited, the photo has no
// stored hash), all of that person's things of that kind in that minute are. It may hide too much; it
// never hides too little, and never touches another person's things or another minute.
import type { Db } from '../supabase.ts'
import { chunks, loadStored, removeFilesWithoutRow, type Counts, type StoredMessage, type StoredPhoto } from './regroup.ts'
import { Stop } from './stop.ts'

export type Kind = 'photo' | 'text' | 'other'
export type Mark = { id: string; chat_key: string; person_slug: string; minute: string; kind: Kind; match: string; exact: boolean }
// `exact`: the mark has matched exactly once (see `matched`).
export type Matching = { person_slug: string; minute: string; kind: Kind; match: string; exact?: boolean }
// `match`: a photo's file hash ('' when it has none), a text message's text, '' for other media.
export type Thing = { slug: string; at: number; kind: Kind; match: string }

// Android's "media omitted" may be a photo, so it is matched with photos.
export const kindOf = (media: { kind: string } | null | undefined): Kind => (!media ? 'text' : media.kind === 'photo' || media.kind === 'media' ? 'photo' : 'other')

const minuteOf = (moment: number) => Math.floor(moment / 60_000) * 60_000
const bucket = (slug: string, moment: number, kind: Kind) => `${slug}\u0000${minuteOf(moment)}\u0000${kind}`

const exactOf = <T extends Thing>(inMinute: T[], mark: { kind: Kind; match: string }) =>
  mark.kind === 'other' ? inMinute : inMinute.filter((thing) => mark.match !== '' && thing.match === mark.match)

// The things a set of marks matches, by the rule above. `stored`: the things are what is stored. A
// mark that has already matched exactly once (`exact`) then hides only exact matches there, so that
// what was in the same minute and is innocent is not hidden because the exact photo is already gone.
// An export is always judged on its own: a re-saved copy of a hidden photo matches nothing exactly.
export function matched<T extends Thing>(things: T[], marks: Matching[], stored = false): { hits: Set<T>; settled: Set<Matching> } {
  const buckets = new Map<string, T[]>()
  for (const thing of things) {
    const key = bucket(thing.slug, thing.at, thing.kind)
    buckets.set(key, [...(buckets.get(key) ?? []), thing])
  }
  const hits = new Set<T>()
  const settled = new Set<Matching>()
  for (const mark of marks) {
    const inMinute = buckets.get(bucket(mark.person_slug, Date.parse(mark.minute), mark.kind)) ?? []
    const exact = exactOf(inMinute, mark)
    if (exact.length > 0 && mark.kind !== 'other') settled.add(mark)
    for (const thing of exact.length > 0 || (stored && mark.exact) ? exact : inMinute) hits.add(thing)
  }
  return { hits, settled }
}

export async function loadMarks(db: Db, chatKey: string): Promise<Mark[]> {
  const found = await db.from('hidden').select('id, chat_key, person_slug, minute, kind, match, exact').eq('chat_key', chatKey).order('hidden_at').order('id')
  if (found.error) throw found.error
  return found.data as Mark[]
}

export type Applied = Counts & { comments: number }
export type StoredThing = Thing & { message: StoredMessage }

// What is stored in a chat, as things to match (a photo's match is the hash stored with it).
export async function storedThings(db: Db, chatId: string): Promise<{ things: StoredThing[]; photos: StoredPhoto[] }> {
  const stored = await loadStored(db, chatId)
  const hashOf = new Map(stored.photos.map((photo) => [photo.key, photo.content_hash ?? '']))
  const things = stored.messages.map((message) => {
    const kind = kindOf(message.media_kind ? { kind: message.media_kind } : null)
    const match = kind === 'text' ? message.text : kind === 'photo' ? (hashOf.get(message.key) ?? '') : ''
    return { message, slug: message.people.slug, at: Date.parse(message.at), kind, match }
  })
  return { things, photos: stored.photos }
}

// Removes every stored row and photo file that a mark of this chat matches, leaves each touched
// memory as an import would (its address and date from its first remaining photo; a memory with no
// photo left is removed, with its comments; messages numbered without gaps), then removes files that
// no row points at (but not one uploaded in the last minute: see `sweepAfterMs`). Rows first, files
// second. Safe to run twice.
export async function applyMarks(db: Db, chatKey: string): Promise<Applied> {
  const none: Applied = { memories: 0, messages: 0, photos: 0, comments: 0 }
  const chat = await db.from('chats').select('id').eq('key', chatKey).maybeSingle()
  if (chat.error) throw chat.error
  if (!chat.data) return none
  const chatId = chat.data.id
  const { things, photos } = await storedThings(db, chatId)
  const marks = await loadMarks(db, chatKey)
  const found = matched(things, marks, true)
  const hits = [...found.hits].map((thing) => thing.message)

  const applied = { ...none, messages: hits.length }
  const paths = photos.filter((photo) => hits.some((message) => message.key === photo.key)).flatMap((photo) => [photo.view_path, photo.thumb_path])
  applied.photos = paths.length / 2
  for (const part of chunks(hits.map((message) => message.id))) {
    const deleted = await db.from('messages').delete().in('id', part)
    if (deleted.error) throw deleted.error
  }
  const settled = marks.filter((mark) => found.settled.has(mark) && !mark.exact).map((mark) => mark.id)
  if (settled.length > 0) {
    const updated = await db.from('hidden').update({ exact: true }).in('id', settled)
    if (updated.error) throw updated.error
  }
  for (const memory of new Set(hits.map((message) => message.memory_id))) await refresh(db, memory, applied)
  try {
    for (const part of chunks(paths)) {
      const removed = await db.storage.from('photos').remove(part)
      if (removed.error) throw removed.error
    }
    await removeFilesWithoutRow(db, chatId)
  } catch (error) {
    const reason = ((error as { message?: string }).message ?? String(error)).replace(/\s+/g, ' ')
    throw new Stop(`Hidden, but the photo files could not be removed (${reason}). Until they are gone, a link a friend already holds keeps working. Run the same command again; it finishes the job.`)
  }
  return applied
}

// A touched memory: gone with its comments when no photo message is left in it; otherwise numbered
// without gaps and with the address and date of its first photo.
async function refresh(db: Db, memoryId: string, applied: Applied): Promise<void> {
  const left = await db.from('messages').select('id, key, at, seq, media_kind').eq('memory_id', memoryId).order('at').order('seq').order('key')
  if (left.error) throw left.error
  const first = left.data.find((message) => message.media_kind === 'photo')
  if (!first) {
    const comments = await db.from('comments').delete().eq('memory_id', memoryId).select('id')
    if (comments.error) throw comments.error
    const gone = await db.from('memories').delete().eq('id', memoryId)
    if (gone.error) throw gone.error
    applied.comments += comments.data.length
    applied.memories += 1
    return
  }
  const photos = await db.from('photos').select('message_id, seq').eq('memory_id', memoryId)
  if (photos.error) throw photos.error
  const photoSeq = new Map(photos.data.map((photo) => [photo.message_id, photo.seq]))
  for (const [seq, message] of left.data.entries()) {
    if (message.seq !== seq) {
      const moved = await db.from('messages').update({ seq }).eq('id', message.id)
      if (moved.error) throw moved.error
    }
    if (photoSeq.has(message.id) && photoSeq.get(message.id) !== seq) {
      const moved = await db.from('photos').update({ seq }).eq('message_id', message.id)
      if (moved.error) throw moved.error
    }
  }
  let moved = await db.from('memories').update({ key: first.key, at: first.at }).eq('id', memoryId)
  if (moved.error?.code === '23505') {
    // An import that read the chat before a hide wrote a second memory for the same first photo, and
    // the one this memory is renamed to is left empty. Its comments go to this one, then it goes.
    const twin = await db.from('memories').select('id').eq('key', first.key).neq('id', memoryId).maybeSingle()
    if (twin.error) throw twin.error
    const held = twin.data && (await db.from('messages').select('id').eq('memory_id', twin.data.id).limit(1))
    if (twin.data && held && !held.error && held.data.length === 0) {
      const carried = await db.from('comments').update({ memory_id: memoryId }).eq('memory_id', twin.data.id)
      if (carried.error) throw carried.error
      const gone = await db.from('memories').delete().eq('id', twin.data.id)
      if (gone.error) throw gone.error
      moved = await db.from('memories').update({ key: first.key, at: first.at }).eq('id', memoryId)
    }
  }
  if (moved.error) throw moved.error
}
