// Hiding (issue 20): what an owner hid is remembered as a mark in the table `hidden`, and one step,
// `applyMarks`, removes what the marks match. The import leaves matching things out before it groups
// and runs the same step at its very end; the owner command `hide` writes marks and runs it.
//
// A mark names the chat, the person, the clock minute, the kind (photo, text, other media) and what
// to match: an upload's key, a photo's hash, a message's text, a clip's key and optional source, or nothing.
// Standalone uploads are matched only by key. For chat exports, the rule is the same
// wherever it is used: among that person's things of that kind in that minute, the ones that match
// exactly are hidden; if none matches (the file was re-saved, the text edited, the photo has no
// stored hash), all of that person's things of that kind in that minute are. It may hide too much; it
// never hides too little, and never touches another person's things or another minute. Whenever it
// hides more than the one thing, the owner is told (`hide` asks first, an import prints a line).
//
// The two phones name the same message differently: an iPhone says "video omitted", an Android phone
// says "media omitted" for any media. So a thing of kind `media` is matched by photo marks and by
// other-media marks, and a mark made on a `media` thing matches photos and other media too.
import type { Db } from '../supabase.ts'
import { chunks, isClipPath, loadStored, removeImportFiles, type Counts, type StoredMemory, type StoredMessage, type StoredPhoto } from './regroup.ts'
import { Stop } from './stop.ts'

export type Kind = 'photo' | 'text' | 'other' | 'media'
export type Mark = { id: string; chat_key: string; person_slug: string; minute: string; kind: Kind; match: string; exact: boolean; pending: string[] }
// `exact`: the mark has matched exactly once (see `matched`).
export type Matching = { id?: string; person_slug: string; minute: string; kind: Kind; match: string; exact?: boolean }
// `match`: an upload key, a photo hash, a message's text, a clip identity, or ''.
export type Thing = { key: string; slug: string; at: number; kind: Kind; match: string; clipSource?: string; unnamedClip?: boolean }

export const kindOf = (media: { kind: string } | null | undefined): Kind =>
  !media ? 'text' : media.kind === 'photo' ? 'photo' : media.kind === 'media' ? 'media' : 'other'

export const unnamedClip = (media: { kind: string; name?: string } | null | undefined) =>
  Boolean(media && !media.name && (media.kind === 'media' || media.kind === 'video' || media.kind === 'voice'))

// Codes use the hexadecimal part of an item's key or a mark's id.
export const codeKey = (idOrKey: string) => idOrKey.replace(/^manual:/, '').replace(/-/g, '')
export const codeOf = (idOrKey: string) => codeKey(idOrKey).slice(0, 8)

export const photoMatch = (key: string, hash?: string | null) => key.startsWith('manual:') ? key : (hash ?? '')

const minuteOf = (moment: number) => Math.floor(moment / 60_000) * 60_000
const together = (a: Kind, b: Kind) => a === b || (a !== 'text' && b !== 'text' && (a === 'media' || b === 'media'))

export const clipMarkKey = (mark: Matching) =>
  mark.kind === 'other' && mark.match.startsWith('clip:') ? mark.match.split(':')[1] : undefined

type LateClipMarks = { knownMarks: ReadonlySet<string>; exportedKeys: ReadonlySet<string> }

// What one mark hit: `exact` when something matched it exactly, `things` all that it hides.
export type Result<T> = { mark: Matching; things: T[]; exact: boolean }

// The things a set of marks matches, by the rule above. `stored`: the things are what is stored. A
// mark that has already matched exactly once (`exact`) then hides only exact matches there, so that
// what was in the same minute and is innocent is not hidden because the exact photo is already gone.
// An export is always judged on its own: a re-saved copy of a hidden photo matches nothing exactly.
export function matched<T extends Thing>(things: T[], marks: Matching[], stored = false, late?: LateClipMarks): { hits: Set<T>; results: Result<T>[] } {
  const hits = new Set<T>()
  const results: Result<T>[] = []
  for (const mark of marks) {
    if (mark.kind === 'other' && mark.match.startsWith('clip:')) {
      const exportedKeys = late && mark.id && !late.knownMarks.has(mark.id) ? late.exportedKeys : undefined
      const hit = clipMatches(things, mark, stored, exportedKeys)
      for (const thing of hit) hits.add(thing)
      results.push({ mark, things: hit, exact: hit.length > 0 })
      continue
    }
    if (mark.kind === 'photo' && mark.match.startsWith('manual:')) {
      const hit = things.filter((thing) => thing.kind === 'photo' && thing.match === mark.match)
      for (const thing of hit) hits.add(thing)
      results.push({ mark, things: hit, exact: hit.length > 0 })
      continue
    }
    const moment = Date.parse(mark.minute)
    const inMinute = things.filter((thing) => thing.slug === mark.person_slug && minuteOf(thing.at) === moment && together(thing.kind, mark.kind))
    const exact = mark.kind === 'other' ? inMinute : inMinute.filter((thing) => mark.match !== '' && thing.match === mark.match)
    const hit = exact.length > 0 || (stored && mark.exact) ? exact : inMinute
    for (const thing of hit) hits.add(thing)
    results.push({ mark, things: hit, exact: exact.length > 0 && mark.kind !== 'other' })
  }
  return { hits, results }
}

function clipMatches<T extends Thing>(things: T[], mark: Matching, stored: boolean, exportedKeys?: ReadonlySet<string>): T[] {
  const [, key, source] = mark.match.split(':')
  if (!source) return things.filter((thing) => thing.key === key)
  const minute = Date.parse(mark.minute)
  const nearby = things.filter((thing) => thing.slug === mark.person_slug && minuteOf(thing.at) === minute)
  const original = nearby.find((thing) => thing.key === key && thing.clipSource === source)
  const unnamed = nearby.filter((thing) => thing.key === key && !thing.clipSource && thing.unnamedClip)
  if (original) return [original]
  if (stored) {
    const moved = exportedKeys ? nearby.filter((thing) => thing.clipSource === source && exportedKeys.has(thing.key)) : []
    return moved.length ? moved : unnamed
  }
  const named = nearby.filter((thing) => thing.clipSource === source)
  if (named.length > 1) {
    throw new Stop('More than one clip in a minute has the same filename as a hidden clip. Use an export that identifies the original clip before importing again.')
  }
  if (named.length === 1) return named
  return unnamed
}

// The marks that left out more than the one thing: nothing innocent goes without a line. A photo or
// text mark with no exact match hides things that are not the one meant; other media always hides all
// of a minute, so only more than one counts.
export function widerThanOne<T>(results: Result<T>[]) {
  return results.filter((result) => !result.exact && result.things.length > (result.mark.kind === 'photo' || result.mark.kind === 'text' ? 0 : 1))
}

export async function loadMarks(db: Db, chatKey: string): Promise<Mark[]> {
  const found = await db.from('hidden').select('id, chat_key, person_slug, minute, kind, match, exact, pending').eq('chat_key', chatKey).order('hidden_at').order('id')
  if (found.error) throw found.error
  return found.data as Mark[]
}

export type Applied = Counts & { comments: number }
export type StoredThing = Thing & { message: StoredMessage }

// What is stored in a chat, as things to match.
export async function storedThings(db: Db, chatId: string): Promise<{ things: StoredThing[]; photos: StoredPhoto[]; memories: StoredMemory[] }> {
  const stored = await loadStored(db, chatId)
  const hashOf = new Map(stored.photos.map((photo) => [photo.key, photo.content_hash ?? '']))
  const things = stored.messages.map((message) => {
    const kind = kindOf(message.media_kind ? { kind: message.media_kind } : null)
    const match = kind === 'text' ? message.text : kind === 'photo' || kind === 'media' ? photoMatch(message.key, hashOf.get(message.key)) : ''
    return {
      message, key: message.key, slug: message.people.slug, at: Date.parse(message.at), kind, match,
      clipSource: message.clip_source ?? undefined,
      unnamedClip: unnamedClip(message.media_kind && { kind: message.media_kind }),
    }
  })
  return { things, photos: stored.photos, memories: stored.memories }
}

// Removes every stored row and media file that a mark of this chat matches, leaves each touched
// memory as an import would (its address and date from its first remaining photo; a memory with no
// photo left is removed, with its comments; messages numbered without gaps). Rows first, files second:
// the paths of the files still to remove are kept with the mark, so a run that fails is finished by
// the next one (`hide`, `hidden` and every import run this). It removes exactly those files and never
// sweeps the bucket: only an import does that, at its own end. Safe to run twice.
export async function applyMarks(db: Db, chatKey: string, late?: LateClipMarks): Promise<Applied> {
  const none: Applied = { memories: 0, messages: 0, photos: 0, comments: 0 }
  const chat = await db.from('chats').select('id').eq('key', chatKey).maybeSingle()
  if (chat.error) throw chat.error
  if (!chat.data) return none
  const marks = await loadMarks(db, chatKey)
  const { things, photos, memories: storedMemories } = await storedThings(db, chat.data.id)
  const found = matched(things, marks, true, late)
  const hits = [...found.hits].map((thing) => thing.message)

  // Every memory a row was removed from, and any left in a state a stopped run leaves (a gap in the
  // numbering, an address or date that is not its first photo's): a run that failed is finished here.
  const gone = new Set(hits.map((message) => message.id))
  const dirty = new Set(hits.map((message) => message.memory_id))
  const byMemory = new Map<string, StoredMessage[]>()
  for (const thing of things) if (!gone.has(thing.message.id)) byMemory.set(thing.message.memory_id, [...(byMemory.get(thing.message.memory_id) ?? []), thing.message])
  const orphanedClips = new Map<string, string[]>()
  for (const memory of storedMemories) {
    const held = (byMemory.get(memory.id) ?? []).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.seq - b.seq)
    const first = held.find((message) => message.media_kind === 'photo')
    if (!first) {
      orphanedClips.set(memory.id, held.flatMap((message) => message.clip_path ? [message.clip_path] : []))
    }
    if (!first || held.some((message, index) => message.seq !== index) || first.key !== memory.key || Date.parse(first.at) !== Date.parse(memory.at)) dirty.add(memory.id)
  }

  const hitKeys = new Set(hits.map((message) => message.key))
  const photosByKey = new Map(photos.map((photo) => [photo.key, photo]))
  const pathsOf = ({ message }: StoredThing) => {
    const photo = photosByKey.get(message.key)
    return [...(photo ? [photo.view_path, photo.thumb_path] : []), ...(message.clip_path ? [message.clip_path] : [])]
  }
  const applied = { ...none, messages: hits.length, photos: photos.filter((photo) => hitKeys.has(photo.key)).length }
  // Record the files and exact matches before the rows that identify them disappear.
  for (const result of found.results) {
    const mark = result.mark as Mark
    const paths = result.things.flatMap((thing) => [
      ...pathsOf(thing),
      ...(orphanedClips.get(thing.message.memory_id) ?? []),
    ])
    if (paths.length === 0) continue
    const kept = await db.from('hidden').update({ pending: [...new Set([...mark.pending, ...paths])] }).eq('id', mark.id)
    if (kept.error) throw kept.error
  }
  const settled = found.results.filter((result) => result.exact && !(result.mark as Mark).exact).map((result) => (result.mark as Mark).id)
  if (settled.length > 0) {
    const updated = await db.from('hidden').update({ exact: true }).in('id', settled)
    if (updated.error) throw updated.error
  }
  for (const part of chunks(hits.map((message) => message.id))) {
    const deleted = await db.from('messages').delete().in('id', part)
    if (deleted.error) throw deleted.error
  }
  failForTest('rows')
  for (const memory of dirty) await refresh(db, memory, applied)
  await removeFiles(db, await loadMarks(db, chatKey))
  return applied
}

// A seam for tests only: EZELI_TEST_FAIL=rows stops a run after the rows are removed, =files makes the
// removal of files fail, as a database or storage that is down would.
function failForTest(where: 'rows' | 'files'): void {
  if (process.env.EZELI_TEST_FAIL === where) throw new Error(where === 'rows' ? 'simulated database failure' : 'storage is down')
}

// Removes the files remembered with the marks, then forgets them. Says so in one plain line, with the
// command that finishes the job, when it cannot.
async function removeFiles(db: Db, marks: Mark[]): Promise<void> {
  for (const mark of marks.filter((candidate) => candidate.pending.length > 0)) {
    try {
      failForTest('files')
      const stillReferenced = new Set<string>()
      for (const paths of chunks(mark.pending.filter(isClipPath))) {
        const references = await db.from('messages').select('clip_path').in('clip_path', paths)
        if (references.error) throw references.error
        for (const row of references.data) stillReferenced.add(row.clip_path)
      }
      await removeImportFiles(db, mark.pending.filter((path) => !stillReferenced.has(path)))
      const cleared = await db.from('hidden').update({ pending: [] }).eq('id', mark.id)
      if (cleared.error) throw cleared.error
    } catch (error) {
      const reason = ((error as { message?: string }).message ?? String(error)).replace(/\s+/g, ' ')
      throw new Stop(`Hidden, but the media files could not be removed (${reason}). Until they are gone, a link a friend already holds keeps working. Run: pnpm ezeli hidden (it removes them).`)
    }
  }
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
