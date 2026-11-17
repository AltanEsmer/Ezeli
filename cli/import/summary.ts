// What an import prints: the numbers an owner checks, before saving (trial run) or after.
import type { Media, MediaKind } from './chat.ts'
import { hasPhotoFile, type Memory, type MemoryMessage } from './memories.ts'
import { removePhoneNumbers } from './text.ts'
import { clockTimeOf } from './time.ts'

// `savedAs` is the chat name when the import saved; without it this is a trial run.
export function importSummary(memories: Memory[], problems: string[], zone: string, details: boolean, savedAs?: string): string {
  const all = memories.flatMap((memory) => memory.messages)
  const lines = [
    savedAs === undefined ? 'Trial run. Nothing was saved.' : `Saved to the chat "${savedAs}".`,
    '',
    `Memories:    ${memories.length}`,
    `Photos:      ${all.filter(hasPhotoFile).length}`,
    `People:      ${countAndNames(all)}`,
    `Date range:  ${dateRange(memories, zone)}`,
    `Problems:    ${problems.length === 0 ? 'none' : problems.length}`,
    ...problems.map((problem) => `  - ${problem}`),
  ]

  memories.forEach((memory, index) => {
    const photos = memory.messages.filter(hasPhotoFile).length
    const others = memory.messages.length - photos
    if (index === 0 || details) lines.push('')
    lines.push(
      `${String(index + 1).padStart(3)}. ${day(memory.at, zone)} ${minute(memory.at, zone)}  ` +
        `${count(photos, 'photo')}, ${count(others, 'message')}  ${names(memory.messages).join(', ')}`,
    )
    if (details) for (const message of memory.messages) lines.push(...conversationLines(message, zone))
  })

  return lines.join('\n') + '\n'
}

const placeholders: Record<MediaKind, string> = {
  photo: 'Photo',
  video: 'Video',
  gif: 'GIF',
  voice: 'Voice message',
  document: 'Document',
}

function conversationLines(message: MemoryMessage, zone: string): string[] {
  const start = `       ${minute(message.at, zone)}  ${message.person}: `
  const said = [message.media && mediaLine(message.media), message.text].filter(Boolean).join(' ')
  return said
    .split('\n')
    .map((line, index) => (index === 0 ? start + line : ' '.repeat(start.length) + line).trimEnd())
}

function mediaLine(media: Media): string {
  if (media.kind !== 'photo') return `[${placeholders[media.kind]}]`
  return media.file ? `[Photo: ${removePhoneNumbers(media.name ?? '')}]` : '[Photo missing from the export]'
}

function countAndNames(messages: MemoryMessage[]): string {
  const people = names(messages)
  return people.length === 0 ? '0' : `${people.length} (${people.join(', ')})`
}

function names(messages: MemoryMessage[]): string[] {
  return [...new Set(messages.map((message) => message.person))].sort((a, b) => a.localeCompare(b, 'tr'))
}

function dateRange(memories: Memory[], zone: string): string {
  const first = memories[0]
  const last = memories.at(-1)
  return first && last ? `${day(first.at, zone)} to ${day(last.at, zone)}` : 'none'
}

function day(moment: number, zone: string): string {
  const { year, month, day } = clockTimeOf(moment, zone)
  return `${year}-${two(month)}-${two(day)}`
}

function minute(moment: number, zone: string): string {
  const { hour, minute } = clockTimeOf(moment, zone)
  return `${two(hour)}:${two(minute)}`
}

function two(value: number): string {
  return String(value).padStart(2, '0')
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`
}
