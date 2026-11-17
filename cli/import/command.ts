// pnpm ezeli import <export folder> --people <file> --timezone <zone> --chat <name> [--trial]
import { parseArgs } from 'node:util'
import { adminClient } from '../supabase.ts'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { chatKey, idKey, messageKeys } from './keys.ts'
import { startingGrouping, buildMemories, type Grouping, type MemoryMessage } from './memories.ts'
import { isDiscordExport, readDiscord } from './discord.ts'
import { readPeople } from './people.ts'
import { whyUnreadable } from './photos.ts'
import { saveChat } from './save.ts'
import { Stop } from './stop.ts'
import { importSummary } from './summary.ts'
import { isTimeZone, momentText } from './time.ts'
import { readWhatsApp } from './whatsapp.ts'

const usage =
  'Usage: pnpm ezeli import <export folder> --people <file> --timezone <zone> --chat <name> [--trial]\n' +
  '  [--details] [--photo-gap <minutes>] [--before <minutes>] [--after <minutes>] [--max-messages <number>]\n' +
  '  --chat names the chat; importing a later export of the same chat under the same name keeps it one chat.\n' +
  '  --trial saves nothing (then --chat is not needed). Saving needs SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.'

export async function runImport(args: string[]): Promise<number> {
  try {
    process.stdout.write(await importExport(args))
    return 0
  } catch (error) {
    if (!(error instanceof Stop)) throw error
    console.error(error.message)
    return 1
  }
}

async function importExport(args: string[]): Promise<string> {
  const { folder, people, timezone, chat: chatName, trial, details, grouping } = readArgs(args)
  if (!isTimeZone(timezone)) {
    throw new Stop(`Unknown time zone: ${timezone}. Use a name such as Europe/Istanbul.`)
  }
  if (!trial && !chatName) throw new Stop(`Saving needs a name for the chat.\n${usage}`)
  // Before anything is read, so a missing key does not cost a long run.
  const db = trial ? undefined : databaseOrStop()

  const who = readPeople(people)
  // The kind of export is recognised from the folder's contents.
  if (!existsSync(join(folder, '_chat.txt')) && !existsSync(join(folder, 'messages.json'))) {
    throw new Stop(`No _chat.txt in ${folder} (WhatsApp iPhone export), and no messages.json (Discord export).`)
  }
  const chat = isDiscordExport(folder) ? readDiscord(folder, timezone) : readWhatsApp(folder, timezone)

  // A Discord sender is its account id; the name is only shown to help the owner add it.
  const unknown = [
    ...new Set(
      chat.messages
        .filter((m) => !who.find(chat.app, m.sender, m.names))
        .map((m) => (m.names?.[0] ? `${m.names[0]} (${m.sender})` : m.sender)),
    ),
  ]
  if (unknown.length > 0) {
    throw new Stop(`Not in the people file: ${unknown.sort((a, b) => a.localeCompare(b, 'tr')).join(', ')}\nAdd them, or mark them "leftOut". See docs/import.md.`)
  }

  // Left-out senders are dropped here, before grouping and before problems are worked out, so
  // nothing about them reaches the result. Problems name the person by display name only.
  const chatText = chatKey(chat.app, chatName ?? '')
  const key = messageKeys(chatText)
  const messages: MemoryMessage[] = []
  const problems = [...chat.problems]
  for (const { sender, names, id, at, minute, text, media } of chat.messages) {
    const person = who.find(chat.app, sender, names)!
    if (person.leftOut) continue
    const message: MemoryMessage = {
      key: id === undefined ? key({ minute, personId: person.id, text, ...(media && { media }) }) : idKey(chatText, id),
      at,
      person: person.name,
      personId: person.id,
      text,
    }
    if (media) message.media = media
    messages.push(message)
    if (media?.kind !== 'photo') continue
    const where = `${person.name}, ${momentText(at, timezone)}`
    if (!media.file) {
      problems.push(`Photo missing from the export: ${media.name ?? 'no file in the export'} (${where})`)
      continue
    }
    // A photo that cannot be read is a problem to report, not a crash. It stays in the
    // conversation as a photo that is missing.
    const reason = await whyUnreadable(media.file)
    if (reason) {
      problems.push(`Photo could not be read: ${media.name} (${where}): ${reason}`)
      delete media.file
    }
  }

  const memories = buildMemories(messages, grouping)
  if (db) {
    try {
      await saveChat(db, { key: chatKey(chat.app, chatName!), name: chatName!.trim(), app: chat.app, timezone }, memories)
    } catch (error) {
      if (error instanceof Stop) throw error
      // Plain words, no stack. Everything is saved by key, so the same import finishes the job.
      const reason = ((error as { message?: string }).message ?? String(error)).replace(/\s+/g, ' ')
      throw new Stop(`Saving stopped before it finished: ${reason}. Fix that and run the same import again; it finishes the job.`)
    }
  }
  return importSummary(memories, problems, timezone, details, trial ? undefined : chatName!.trim())
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
      return {
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
