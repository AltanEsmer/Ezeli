// pnpm ezeli import <export folder> --people <file> --timezone <zone> --chat <name> [--trial]
import { parseArgs } from 'node:util'
import { adminClient } from '../supabase.ts'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chatKey, idKey, messageKeys } from './keys.ts'
import { startingGrouping, buildMemories, type Grouping, type MemoryMessage } from './memories.ts'
import { isDiscordExport, readDiscord, withMentions } from './discord.ts'
import { readPeople } from './people.ts'
import { captureLocation } from '../../src/captureLocation.ts'
import { readablePhoto, removeConvertedPhotos } from './photos.ts'
import { codeOf, kindOf, loadMarks, matched, unnamedClip, widerThanOne, type Mark } from './marks.ts'
import { loadStored, nothingStored, spanOf } from './regroup.ts'
import { previewClips, saveChat, type ChatToSave, type SaveReport } from './save.ts'
import { prepareMemoryClips, removeConvertedClips } from './clips.ts'
import { Stop } from './stop.ts'
import { importSummary } from './summary.ts'
import { cleanText, removePhoneNumbers } from './text.ts'
import { isTimeZone, momentText } from './time.ts'
import { readWhatsApp, type DateOrder } from './whatsapp.ts'

const usage =
  'Usage: pnpm ezeli import <export folder> --people <file> --timezone <zone> --chat <name> [--trial]\n' +
  '  [--date-order day-first|month-first] [--details] [--photo-gap <minutes>] [--before <minutes>] [--after <minutes>] [--max-messages <number>]\n' +
  '  --chat names the chat; importing a later export of the same chat under the same name keeps it one chat.\n' +
  '  --trial saves nothing. Use --chat and the database environment to preview an existing chat.'

export async function runImport(args: string[]): Promise<number> {
  try {
    process.stdout.write(await importExport(args))
    return 0
  } catch (error) {
    if (!(error instanceof Stop)) throw error
    console.error(error.message)
    return 1
  } finally {
    removeConvertedPhotos()
    removeConvertedClips()
  }
}

async function importExport(args: string[]): Promise<string> {
  const { folder, people, timezone, chat: chatName, trial, details, grouping, dateOrder } = readArgs(args)
  if (!isTimeZone(timezone)) {
    throw new Stop(`Unknown time zone: ${timezone}. Use a name such as Europe/Istanbul.`)
  }
  if (!trial && !chatName) throw new Stop(`Saving needs a name for the chat.\n${usage}`)
  // Before anything is read, so a missing key does not cost a long run.
  const withArchive = chatName && process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
  const db = trial && !withArchive ? undefined : databaseOrStop()

  const who = readPeople(people)
  // The kind of export is recognised from the folder's contents.
  const hasText = existsSync(folder) && readdirSync(folder).some((name) => /\.txt$/i.test(name))
  if (!hasText && !existsSync(join(folder, 'messages.json'))) {
    throw new Stop(`No _chat.txt in ${folder} (WhatsApp iPhone export), no .txt chat file (Android), and no messages.json (Discord export).`)
  }
  const chat = isDiscordExport(folder) ? readDiscord(folder, timezone) : readWhatsApp(folder, timezone, dateOrder)

  // The one place a sender is printed as written: the owner cannot fill in the people file
  // without it. A Discord sender is its account id; the name only helps to add it.
  const unknown = [
    ...new Set(
      chat.messages
        .filter((m) => !who.find(chat.app, m.sender))
        .map((m) => (m.names?.length ? `${m.names.join(' / ')} (${m.sender})` : m.sender)),
    ),
  ]
  if (unknown.length > 0) {
    const list = [...new Set(unknown)].sort((a, b) => a.localeCompare(b, 'tr')).join(', ')
    throw new Stop(
      'This list is exactly as written in the export. It can hold phone numbers: do not paste it anywhere.\n' +
        `Not in the people file: ${list}\nAdd them, or mark them "leftOut". See docs/import.md.`,
    )
  }

  // Left-out senders are dropped here, before grouping and before problems are worked out, so
  // nothing about them reaches the result. Problems name the person by display name only.
  const chatText = chatKey(chat.app, chatName ?? '')
  // The secret every key of this chat is made with: the chat's own, or a new one for a new chat.
  const archived = db ? await savingStop(() => importChat(db, { key: chatText, name: chatName!.trim(), app: chat.app, timezone }, trial)) : undefined
  const secret = archived?.secret
  const key = messageKeys(chatText, secret)
  const messages: MemoryMessage[] = []
  const legacyCaptions = new Map<MemoryMessage, string>()
  const problems = [...chat.problems]
  for (const { sender, id, captionId, at, minute, media, mentions, ...said } of chat.messages) {
    const person = who.find(chat.app, sender)!
    if (person.leftOut) continue
    // A mention shows the person's Ezeli name; a left-out or unknown person is removed.
    // WhatsApp mentions and phone numbers are cleaned in the same way, before anything is keyed.
    // `plain` is the WhatsApp text without mentions, for the key (see text.ts).
    const cleaned = id === undefined ? cleanText(said.text, who) : undefined
    const text = mentions ? withMentions(said.text, mentions, (account) => who.find(chat.app, account)) : (cleaned?.shown ?? said.text)
    if (!media && text.trim() === '') continue
    const message: MemoryMessage = {
      key: id === undefined ? key({ minute, personId: person.id, text: cleaned?.plain ?? text, ...(media && { media }) }) : idKey(chatText, id, secret),
      at,
      person: person.name,
      personId: person.id,
      text,
    }
    if (media) {
      if (secret && chat.app === 'whatsapp' && media.name && (media.kind === 'video' || media.kind === 'voice')) {
        media.clipSource = idKey(chatText, `clip-source:${media.name.normalize('NFC')}`, secret)
        if (media.file) {
          const digest = await clipDigest(media.file)
          if (digest) media.clipDigest = idKey(chatText, `clip-digest:${digest}`, secret)
        }
      }
      message.media = media
    }
    if (captionId) legacyCaptions.set(message, idKey(chatText, captionId, secret))
    messages.push(message)
    if (media?.kind !== 'photo') continue
    const where = `${person.name}, ${momentText(at, timezone)}`
    if (!media.file) {
      problems.push(`Photo missing from the export: ${media.name ?? 'no file in the export'} (${where})`)
      continue
    }
    // The hash of the original file, kept with the photo so hiding it can find it again.
    if (archived) {
      const original = readFileSync(media.file)
      media.hash = createHash('sha256').update(original).digest('hex')
      media.location = await captureLocation(original)
    }
    // A photo that cannot be read is a problem to report, not a crash. It stays in the
    // conversation as a photo that is missing.
    const readable = await readablePhoto(media.file)
    if ('reason' in readable) {
      problems.push(`Photo could not be read: ${media.name} (${where}): ${readable.reason}`)
      delete media.file
    } else media.file = readable.file
  }

  // What an owner hid is left out here, before grouping, so the summary matches the app (marks.ts).
  // The keys above were worked out with it in place, so what stays keeps the key it has stored.
  const leftOut: string[] = []
  const marks = db ? await savingStop(() => loadMarks(db, chatText)) : []
  const stored = db && archived && (trial || marks.some((mark) => mark.kind === 'other' && mark.match.startsWith('clip:') && mark.match.split(':')[2]))
    ? await savingStop(() => loadStored(db, archived.id))
    : nothingStored
  const identity = (slug: string, at: number, source: string) => JSON.stringify([slug, Math.floor(at / 60_000), source])
  const knownClips = new Set(stored.messages.flatMap((row) => row.clip_source ? [identity(row.people.slug, Date.parse(row.at), row.clip_source)] : []))
  if (db) {
    const things = messages.map((message) => ({
      message, slug: message.personId, at: message.at, key: message.key, kind: kindOf(message.media),
      match: message.media ? (message.media.hash ?? '') : message.text,
      clipSource: message.media?.clipSource, clipDigest: message.media?.clipDigest,
      knownClip: Boolean(message.media?.clipSource && knownClips.has(identity(message.personId, message.at, message.media.clipSource))),
      unnamedClip: unnamedClip(message.media),
    }))
    const captions = things.flatMap((thing) => {
      const captionKey = legacyCaptions.get(thing.message)
      return captionKey ? [{ ...thing, key: captionKey, kind: 'text' as const, match: thing.message.text, clipSource: undefined, clipDigest: undefined, unnamedClip: false }] : []
    })
    const { hits: hidden, results } = matched([...things, ...captions], marks)
    for (const { message } of captions.filter((caption) => hidden.has(caption))) {
      message.text = ''
      message.media!.captionHidden = true
    }
    // Nothing innocent goes without a line: a mark that could not match exactly left out others.
    for (const result of widerThanOne(results)) {
      const mark = result.mark as Mark
      const others = result.things.length - (mark.kind === 'photo' || mark.kind === 'text' ? 0 : 1)
      const first = result.things[0]!
      leftOut.push(`Left out by a hidden mark: ${first.message.person}, ${momentText(first.message.at, timezone)}, ${others} other ${others === 1 ? 'thing' : 'things'}. If the hidden thing is no longer in the chat, pnpm ezeli show ${codeOf(mark.id)} brings them back at the next import.`)
    }
    const kept = things.filter((thing) => !hidden.has(thing)).map((thing) => thing.message)
    messages.length = 0
    for (const message of kept) messages.push(message)
  }

  const memories = buildMemories(messages, grouping)
  let report: SaveReport | undefined
  // Only replace the part of the chat covered by this export, including left-out senders.
  const span = spanOf(chat.messages.map((message) => message.at))
  if (db && !trial) {
    try {
      report = await saveChat(db, { key: chatText, name: chatName!.trim(), app: chat.app, timezone }, messages, grouping, span, marks)
    } catch (error) {
      if (error instanceof Stop) throw error
      // Plain words, no stack. Everything is saved by key, so the same import finishes the job.
      const reason = ((error as { message?: string }).message ?? String(error)).replace(/\s+/g, ' ')
      throw new Stop(`Saving stopped before it finished: ${reason}. Fix that and run the same import again; it finishes the job.`)
    }
  }
  const summary = importSummary(memories, problems.map(removePhoneNumbers), timezone, details, report && chatName!.trim(), report)
  const clips = report?.clips ?? (archived
    ? previewClips(stored, messages, grouping, span, marks, timezone)
    : prepareMemoryClips(memories, timezone))
  const notes = [...clips, ...leftOut]
  return notes.length > 0 ? `${summary}\n${notes.join('\n')}\n` : summary
}

// A failed request before saving is told in plain words, like a failed save.
async function savingStop<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof Stop) throw error
    const reason = ((error as { message?: string }).message ?? String(error)).replace(/\s+/g, ' ')
    throw new Stop(`Saving stopped before it finished: ${reason}. Fix that and run the same import again; it finishes the job.`)
  }
}

// The secret of a stored chat; none for a chat stored before secrets existed (it keeps its keys). A
// chat not stored yet is stored now, with a new secret, so that two imports of it that start together
// make their keys with the same one.
async function importChat(db: ReturnType<typeof databaseOrStop>, chat: ChatToSave, trial: boolean) {
  const read = async () => {
    const found = await db.from('chats').select('id, secret, timezone').eq('key', chat.key).maybeSingle()
    if (found.error) throw found.error
    return found.data
  }
  const there = await read()
  if (there) {
    if (there.timezone !== chat.timezone) throw new Stop(`This chat was first imported with the time zone ${there.timezone}, not ${chat.timezone}. Import it again with --timezone ${there.timezone}; nothing was changed.`)
    if (!there.secret) throw new Stop('This chat was stored before its keys had a secret, so it cannot be imported again. Remove the chat and import it again (no real chat exists yet).')
    return there
  }
  if (trial) return undefined
  const made = await db.from('chats').upsert({ ...chat, secret: randomBytes(24).toString('hex') }, { onConflict: 'key', ignoreDuplicates: true })
  if (made.error) throw made.error
  const made2 = await read()
  if (!made2?.secret) throw new Stop('The chat could not be stored with a secret. Run the same import again.')
  return made2
}

async function clipDigest(file: string): Promise<string | undefined> {
  const hash = createHash('sha256')
  try {
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    return hash.digest('hex')
  } catch {
    // Playback preparation reports unreadable files as skipped clips.
    return undefined
  }
}

function databaseOrStop() {
  try {
    return adminClient()
  } catch (error) {
    throw new Stop((error as Error).message)
  }
}

function readArgs(args: string[]) {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        people: { type: 'string' },
        timezone: { type: 'string' },
        chat: { type: 'string' },
        trial: { type: 'boolean', default: false },
        details: { type: 'boolean', default: false },
        'photo-gap': { type: 'string' },
        before: { type: 'string' },
        after: { type: 'string' },
        'max-messages': { type: 'string' },
        'date-order': { type: 'string' },
      },
    })
    const [folder, ...rest] = positionals
    if (folder && rest.length === 0 && values.people && values.timezone) {
      const grouping: Grouping = {
        photoGapMinutes: number(values, 'photo-gap', startingGrouping.photoGapMinutes),
        beforeMinutes: number(values, 'before', startingGrouping.beforeMinutes),
        afterMinutes: number(values, 'after', startingGrouping.afterMinutes),
        maxMessages: number(values, 'max-messages', startingGrouping.maxMessages),
      }
      const dateOrder = values['date-order']
      if (dateOrder !== undefined && dateOrder !== 'day-first' && dateOrder !== 'month-first') {
        throw new Stop('--date-order must be day-first or month-first.')
      }
      return {
        dateOrder: dateOrder as DateOrder | undefined,
        folder,
        people: values.people,
        timezone: values.timezone,
        chat: values.chat?.trim() || undefined,
        trial: values.trial,
        details: values.details,
        grouping,
      }
    }
  } catch (error) {
    if (error instanceof Stop) throw error
    // An option that does not exist: fall through to the usage line.
  }
  throw new Stop(usage)
}

function number(values: Record<string, unknown>, option: string, fallback: number): number {
  const text = values[option]
  if (text === undefined) return fallback
  if (typeof text === 'string' && /^\d+$/.test(text)) return Number(text)
  const unit = option === 'max-messages' ? 'a whole number of messages' : 'a whole number of minutes'
  throw new Stop(`--${option} must be ${unit}, such as ${fallback}.`)
}
