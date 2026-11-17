// pnpm ezeli import <export folder> --people <file> --timezone <zone> --trial
import { parseArgs } from 'node:util'
import { startingGrouping, buildMemories, type Grouping, type MemoryMessage } from './memories.ts'
import { readPeople } from './people.ts'
import { Stop } from './stop.ts'
import { trialSummary } from './summary.ts'
import { isTimeZone } from './time.ts'
import { readWhatsApp } from './whatsapp.ts'

const usage =
  'Usage: pnpm ezeli import <export folder> --people <file> --timezone <zone> --trial\n' +
  '  [--details] [--photo-gap <minutes>] [--before <minutes>] [--after <minutes>] [--max-messages <number>]'

export async function runImport(args: string[]): Promise<number> {
  try {
    process.stdout.write(importExport(args))
    return 0
  } catch (error) {
    if (!(error instanceof Stop)) throw error
    console.error(error.message)
    return 1
  }
}

function importExport(args: string[]): string {
  const { folder, people, timezone, trial, details, grouping } = readArgs(args)
  if (!isTimeZone(timezone)) {
    throw new Stop(`Unknown time zone: ${timezone}. Use a name such as Europe/Istanbul.`)
  }
  if (!trial) {
    throw new Stop('Saving is not built yet (issue 11). Add --trial to see what would be imported.')
  }

  const who = readPeople(people)
  const chat = readWhatsApp(folder, timezone)

  const unknown = [...new Set(chat.messages.map((m) => m.sender).filter((sender) => !who.find(chat.app, sender)))]
  if (unknown.length > 0) {
    throw new Stop(`Not in the people file: ${unknown.sort((a, b) => a.localeCompare(b, 'tr')).join(', ')}\nAdd them, or mark them "leftOut". See docs/import.md.`)
  }

  const messages: MemoryMessage[] = []
  for (const { sender, at, text, media } of chat.messages) {
    const person = who.find(chat.app, sender)!
    if (!person.leftOut) messages.push({ at, person: person.name, text, ...(media && { media }) })
  }

  return trialSummary(buildMemories(messages, grouping), chat.problems, timezone, details)
}

function readArgs(args: string[]) {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        people: { type: 'string' },
        timezone: { type: 'string' },
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
      return { folder, people: values.people, timezone: values.timezone, trial: values.trial, details: values.details, grouping }
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
