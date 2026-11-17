// Reads a WhatsApp export in the iPhone layout: a `_chat.txt` with the media files next to it.
// Knows nothing about people or memories; it only turns the file into a ChatExport.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatExport, ChatMessage, Media, MediaKind } from './chat.ts'
import { Stop } from './stop.ts'
import { clockTimeOf, momentOf } from './time.ts'
import { cleanSender } from './people.ts'

// iPhone layout: "[14.07.2023, 20:58:11] Name: text". Dots or slashes, day first.
// (Other date formats are issue 12.)
const header = /^‎?\[(\d{1,2})[./](\d{1,2})[./](\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\] (.*)$/
const leftToRight = '‎'

export function readWhatsApp(folder: string, zone: string): ChatExport {
  const chatFile = join(folder, '_chat.txt')
  if (!existsSync(chatFile)) throw new Stop(`No _chat.txt in ${folder}. Give the unzipped iPhone export folder.`)

  const lines = readFileSync(chatFile, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
  const files = new Set(readdirSync(folder).map((name) => name.normalize('NFC')))
  const problems: string[] = []
  const messages: ChatMessage[] = []

  // 1. Cut the file into entries. A line that is not a header continues the entry before it.
  const entries: { at: number; rest: string[] }[] = []
  for (const line of lines) {
    const match = header.exec(line)
    if (match) {
      const [, day, month, year, hour, minute, second, rest] = match
      const at = momentOf(
        { year: +year!, month: +month!, day: +day!, hour: +hour!, minute: +minute!, second: +(second ?? 0) },
        zone,
      )
      entries.push({ at, rest: [rest!] })
    } else if (entries.length > 0) {
      entries.at(-1)!.rest.push(line)
    }
  }
  if (entries.length === 0) {
    throw new Stop(`${chatFile} has no messages in the iPhone layout, such as "[14.07.2023, 20:58:11] Name: text".`)
  }

  // 2. Read each entry.
  for (const { at, rest } of entries) {
    const entry = rest.join('\n').replace(/\s+$/, '')
    const split = entry.indexOf(': ')
    if (split < 0) continue // a notice without a sender
    const sender = cleanSender(entry.slice(0, split))
    const body = entry.slice(split + 2)

    const media = readAttachment(body)
    if (media) {
      const { kind, name, caption } = media
      if (kind === 'sticker') continue
      const result: Media = { kind }
      if (name) result.name = name
      if (kind === 'photo') {
        if (name && files.has(name.normalize('NFC'))) result.file = join(folder, name)
        else problems.push(`Photo missing from the export: ${name ?? '(left out, no file name)'} (${sender}, ${when(at, zone)})`)
      }
      messages.push({ at, sender, text: caption, media: result })
      continue
    }

    if (isNotice(body)) continue
    messages.push({ at, sender, text: body })
  }

  return { app: 'whatsapp', messages, problems }
}

function when(moment: number, zone: string): string {
  const c = clockTimeOf(moment, zone)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${c.year}-${two(c.month)}-${two(c.day)} ${two(c.hour)}:${two(c.minute)}`
}

// An attachment is "<attached: file>" (or the older "file (file attached)"), with any caption after it.
// Without media in the export, WhatsApp writes "image omitted" and the like instead.
function readAttachment(body: string): { kind: MediaKind | 'sticker'; name?: string; caption: string } | undefined {
  const text = body.replaceAll(leftToRight, '').trim()
  const attached = /^<attached: (.+?)>\s*([\s\S]*)$/.exec(text) ?? /^(.+?) \(file attached\)\s*([\s\S]*)$/.exec(text)
  if (attached) return { kind: kindOf(attached[1]!), name: attached[1]!, caption: attached[2]! }

  const omitted = /^(?:<)?(image|video|GIF|audio|sticker|document) omitted(?:>)?$/i.exec(text)
  if (omitted) {
    const word = omitted[1]!.toLowerCase()
    return { kind: word === 'image' ? 'photo' : word === 'gif' ? 'gif' : word === 'audio' ? 'voice' : (word as MediaKind | 'sticker'), caption: '' }
  }
  return undefined
}

function kindOf(name: string): MediaKind | 'sticker' {
  const tag = /^\d+-([A-Z]+)-/.exec(name)?.[1]
  if (tag === 'PHOTO') return 'photo'
  if (tag === 'VIDEO') return 'video'
  if (tag === 'GIF') return 'gif'
  if (tag === 'AUDIO') return 'voice'
  if (tag === 'STICKER') return 'sticker'
  const extension = name.split('.').at(-1)!.toLowerCase()
  if (['jpg', 'jpeg', 'png', 'heic'].includes(extension)) return 'photo'
  if (['mp4', 'mov'].includes(extension)) return 'video'
  if (['opus', 'm4a', 'aac', 'mp3', 'amr'].includes(extension)) return 'voice'
  if (extension === 'webp') return 'sticker'
  return 'document'
}

// iPhone exports start every notice (joined, left, added, created, encryption, deleted) with an
// invisible left-to-right mark. A message someone wrote never does. Deleted-message notices
// are also recognised by their words.
const deleted = /^(this message was deleted\.?|you deleted this message\.?|bu mesaj silindi\.?|bu mesajı sildiniz\.?)$/i

function isNotice(body: string): boolean {
  return body.startsWith(leftToRight) || deleted.test(body.trim())
}
