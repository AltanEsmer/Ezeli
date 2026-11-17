// Reads a WhatsApp export in the iPhone layout: a `_chat.txt` with the media files next to it.
// Knows nothing about people or memories; it only turns the file into a ChatExport.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatExport, ChatMessage, Media, MediaKind } from './chat.ts'
import { cleanSender } from './people.ts'
import { Stop } from './stop.ts'
import { momentOf } from './time.ts'

// iPhone layout: "[14.07.2023, 20:58:11] Name: text". Day first, dots or slashes, comma optional.
// Other date formats and the Android layout are issue 12.
const space = '[   ]'
const header = new RegExp(
  `^‎?\\[(\\d{1,2})[./](\\d{1,2})[./](\\d{4}),?${space}(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\] (.*)$`,
)
const leftToRight = '‎'
const photoFile = /\.(jpe?g|png|heic|heif)$/i

export function readWhatsApp(folder: string, zone: string): ChatExport {
  const chatFile = join(folder, '_chat.txt')
  if (!existsSync(chatFile)) throw new Stop(`No _chat.txt in ${folder}. Give the unzipped iPhone export folder.`)

  const lines = readFileSync(chatFile, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
  const folderFiles = readdirSync(folder)
    .filter((name) => name !== '_chat.txt' && !name.startsWith('.') && statSync(join(folder, name)).isFile())
    .map((name) => name.normalize('NFC'))
  const present = new Set(folderFiles)

  // 1. Cut the file into entries. A line that is not a header continues the entry before it.
  const entries: { at: number; rest: string[] }[] = []
  lines.forEach((line, index) => {
    const match = header.exec(line)
    if (!match) {
      entries.at(-1)?.rest.push(line)
      return
    }
    const [, day, month, year, hour, minute, second, rest] = match.map((part) => part ?? '')
    const clock = { year: +year!, month: +month!, day: +day!, hour: +hour!, minute: +minute!, second: +(second || 0) }
    if (!isRealClockTime(clock)) {
      const stamp = line.slice(line.indexOf('[') + 1, line.indexOf(']'))
      throw new Stop(
        `Line ${index + 1}: ${stamp} is not a day-first date and time. ` +
          'Only the day-first iPhone layout is read so far (other formats are issue 12).',
      )
    }
    entries.push({ at: momentOf(clock, zone), rest: [rest!] })
  })
  if (entries.length === 0) {
    throw new Stop(`${chatFile} has no messages in the iPhone layout, such as "[14.07.2023, 20:58:11] Name: text".`)
  }

  // 2. Read each entry.
  const messages: ChatMessage[] = []
  const referenced = new Set<string>()
  let photoMessages = 0
  for (const { at, rest } of entries) {
    const entry = rest.join('\n').replace(/\s+$/, '')
    const split = entry.indexOf(': ')
    if (split < 0) continue // a notice without a sender
    const sender = cleanSender(entry.slice(0, split))
    const body = entry.slice(split + 2).replace(edited, '')

    const attachment = readAttachment(body)
    if (attachment) {
      if (attachment.name) referenced.add(attachment.name.normalize('NFC'))
      if (attachment.kind === 'sticker') continue
      const media: Media = { kind: attachment.kind }
      if (attachment.name) media.name = attachment.name
      if (attachment.kind === 'photo') {
        photoMessages++
        if (attachment.name && present.has(attachment.name.normalize('NFC'))) media.file = join(folder, attachment.name)
      }
      // A caption is kept for photos only; for other media the text is a file name or page count.
      messages.push({ at, sender, text: attachment.kind === 'photo' ? attachment.caption : '', media })
    } else if (!isNotice(body)) {
      messages.push({ at, sender, text: body })
    }
  }

  // Exports are sometimes slightly out of order. Sort by time; the sort keeps file order for ties.
  messages.sort((a, b) => a.at - b.at)

  // 3. Guard against a layout this reader does not know: files nobody refers to.
  const problems: string[] = []
  const unmentioned = folderFiles.filter((name) => !referenced.has(name))
  if (unmentioned.length > 0) {
    const shown = unmentioned.slice(0, 5).join(', ') + (unmentioned.length > 5 ? ', ...' : '')
    const count = unmentioned.length === 1 ? '1 media file in the export is' : `${unmentioned.length} media files in the export are`
    problems.push(`${count} not mentioned in the chat: ${shown}`)
    if (photoMessages === 0 && unmentioned.some((name) => photoFile.test(name))) {
      problems.push('The folder has photo files but no photo was read. The chat may be in a layout this reader does not know.')
    }
  }

  return { app: 'whatsapp', messages, problems }
}

function isRealClockTime(c: { year: number; month: number; day: number; hour: number; minute: number; second: number }) {
  if (c.month < 1 || c.month > 12 || c.hour > 23 || c.minute > 59 || c.second > 59 || c.day < 1) return false
  return c.day <= new Date(Date.UTC(c.year, c.month, 0)).getUTCDate()
}

// An attachment is a tag "<attached: file>" anywhere in the message (the word differs by language,
// so only its shape is matched), or the older "file (file attached)". Caption text is what is left.
// Without media in the export, WhatsApp writes "image omitted" and the like instead.
function readAttachment(body: string): { kind: MediaKind | 'sticker'; name?: string; caption: string } | undefined {
  const text = body.replaceAll(leftToRight, '')
  const tag = /<[^<>:\n]+: ([^<>\n]+)>/.exec(text)
  if (tag) return { kind: kindOf(tag[1]!.trim()), name: tag[1]!.trim(), caption: text.replace(tag[0], '').trim() }

  const old = /^(.+?) \((?:file attached|dosya ekli)\)\s*([\s\S]*)$/.exec(text.trim())
  if (old) return { kind: kindOf(old[1]!), name: old[1]!, caption: old[2]! }

  const omitted = /^<?(image|video|GIF|audio|sticker|document) omitted>?$/i.exec(text.trim())
  if (omitted) {
    const word = omitted[1]!.toLowerCase()
    const kind = word === 'image' ? 'photo' : word === 'audio' ? 'voice' : (word as MediaKind | 'sticker')
    return { kind, caption: '' }
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
  if (['jpg', 'jpeg', 'png', 'heic', 'heif'].includes(extension)) return 'photo'
  if (['mp4', 'mov', '3gp'].includes(extension)) return 'video'
  if (['opus', 'm4a', 'mp3', 'aac', 'ogg', 'amr'].includes(extension)) return 'voice'
  if (extension === 'webp') return 'sticker'
  return 'document'
}

// The marker WhatsApp adds at the end of an edited message.
const edited = /\s*‎?<(?:This message was edited|Bu mesaj düzenlendi)>\s*$/i

// iPhone exports start every notice (joined, left, added, created, encryption, deleted) with an
// invisible left-to-right mark. A message someone wrote never does. Deleted-message notices
// are also recognised by their words.
const deleted = /^(this message was deleted\.?|you deleted this message\.?|bu mesaj silindi\.?|bu mesajı sildiniz\.?)$/i

function isNotice(body: string): boolean {
  return body.startsWith(leftToRight) || deleted.test(body.trim())
}
