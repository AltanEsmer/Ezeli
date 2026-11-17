// Reads a WhatsApp export: the chat text (`_chat.txt` on an iPhone, one .txt file on Android) with
// the media files next to it. Knows nothing about people or memories; it only turns the folder
// into a ChatExport. Which words and shapes it knows, and which are only believed, is in
// docs/import.md.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatExport, ChatMessage, Media, MediaKind } from './chat.ts'
import { cleanSender } from './people.ts'
import { Stop } from './stop.ts'
import { momentOf } from './time.ts'

export type DateOrder = 'day-first' | 'month-first'

// Invisible marks: U+200E (left-to-right) starts what WhatsApp wrote itself on an iPhone.
const lrm = '‎'
const marks = '[\\u200e\\u200f]'
// The space before AM or PM is often a narrow no-break space (U+202F) or a no-break space.
const space = '[ \\u202f\\u00a0]'
const date = '(?<a>\\d{1,4})[./-](?<b>\\d{1,2})[./-](?<c>\\d{2,4})'
// Turkish 12-hour: "ÖÖ" before noon and "ÖS" after, in front of the time. English: AM or PM
// after it, in several spellings. The time separator is a colon, sometimes a dot.
const time =
  `(?:(?<tr>ÖÖ|ÖS)${space}*)?(?<h>\\d{1,2})[:.](?<m>\\d{2})(?:[:.](?<s>\\d{2}))?` +
  `(?:${space}*(?<en>[AaPp])\\.?${space}?[Mm]\\.?)?`
const stamp = `(?<stamp>${date},?${space}+${time})`
// iPhone: "[3.08.2019 09:15:02] Name: text". Android: "8/3/19, 9:15 AM - Name: text".
const headers = {
  bracket: new RegExp(`^${marks}*\\[${stamp}\\]${space}(?<rest>.*)$`),
  dash: new RegExp(`^${marks}*${stamp}${space}-${space}(?<rest>.*)$`),
}

const photoFile = /\.(jpe?g|png|heic|heif)$/i

export function readWhatsApp(folder: string, zone: string, chosenOrder?: DateOrder): ChatExport {
  const chatFile = findChatFile(folder)
  const lines = readFileSync(chatFile, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
  const folderFiles = readdirSync(folder)
    .filter((name) => join(folder, name) !== chatFile && !name.startsWith('.') && statSync(join(folder, name)).isFile())
    .map((name) => name.normalize('NFC'))
  const present = new Set(folderFiles)

  // 1. Find the header lines. A file is in one style (brackets or dash) from top to bottom.
  const found = { bracket: 0, dash: 0 }
  for (const line of lines) {
    if (headers.bracket.test(line)) found.bracket++
    else if (headers.dash.test(line)) found.dash++
  }
  const header = found.bracket >= found.dash ? headers.bracket : headers.dash
  const parsed = lines.map((line) => header.exec(line)?.groups)
  if (!parsed.some(Boolean)) {
    throw new Stop(
      `${chatFile} has no messages in a layout this reader knows, such as "[14.07.2023, 20:58:11] Name: text" ` +
        'or "14.07.2023, 20:58 - Name: text".',
    )
  }

  // 2. Day first or month first is decided once, from the dates themselves.
  const order = dateOrder(parsed, chosenOrder)

  // 3. Cut the file into entries. A line that is not a header continues the entry before it.
  const entries: { at: number; minute: string; rest: string[] }[] = []
  lines.forEach((line, index) => {
    const groups = parsed[index]
    if (!groups) {
      entries.at(-1)?.rest.push(line)
      return
    }
    const clock = clockOf(groups, order)
    if (!clock || !isRealClockTime(clock)) {
      throw new Stop(
        `Line ${index + 1}: ${groups.stamp!.replace(/[  ]/g, ' ')} is not a ${order} date and time.`,
      )
    }
    const two = (n: number) => String(n).padStart(2, '0')
    const minuteText = `${clock.year}-${two(clock.month)}-${two(clock.day)} ${two(clock.hour)}:${two(clock.minute)}`
    entries.push({ at: momentOf(clock, zone), minute: minuteText, rest: [groups.rest!] })
  })

  // 4. Read each entry.
  const messages: ChatMessage[] = []
  const referenced = new Set<string>()
  let photoMessages = 0
  for (const { at, minute, rest } of entries) {
    const entry = rest.join('\n').replace(/\s+$/, '')
    // A notice with no sender starts with the invisible mark on an iPhone.
    if (entry.startsWith(lrm)) continue
    const split = entry.indexOf(': ')
    if (split < 0) continue // a notice without a sender
    if (noticeHead.test(entry.slice(0, split))) continue // a notice that has ": " inside, such as a new group name
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
      messages.push({ at, minute, sender, text: attachment.kind === 'photo' ? attachment.caption : '', media })
    } else if (!isNotice(body) && !isLocation(body)) {
      messages.push({ at, minute, sender, text: body })
    }
  }

  // Exports are sometimes slightly out of order. Sort by time; the sort keeps file order for ties.
  messages.sort((a, b) => a.at - b.at)

  // 5. Guard against a layout this reader does not know: files nobody refers to.
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

// The chat text: `_chat.txt` (iPhone), or the one .txt file of an Android export. Among several,
// the one with "WhatsApp" in its name.
function findChatFile(folder: string): string {
  const missing = new Stop(`No chat text in ${folder}. Give the unzipped export folder: _chat.txt (iPhone) or the .txt file (Android).`)
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw missing
  const names = readdirSync(folder).filter((name) => !name.startsWith('.'))
  if (names.includes('_chat.txt')) return join(folder, '_chat.txt')
  const texts = names.filter((name) => /\.txt$/i.test(name))
  if (texts.length === 0) throw missing
  const named = texts.filter((name) => /whatsapp/i.test(name))
  const chosen = named.length === 1 ? named : texts.length === 1 ? texts : []
  if (chosen.length === 0) {
    throw new Stop(`More than one text file in ${folder} and no way to tell which is the chat. Keep only the chat's .txt file there.`)
  }
  return join(folder, chosen[0]!)
}

type Groups = Record<string, string | undefined>

// "3.08.2019" is 3 August in a day-first export and 8 March in a month-first one. Any date whose
// first number is above 12 shows day first, any whose second is above 12 shows month first.
// A year first date (2019/08/03) needs no deciding.
function dateOrder(parsed: (Groups | undefined)[], chosen?: DateOrder): DateOrder {
  if (chosen) return chosen
  let dayFirst: string | undefined
  let monthFirst: string | undefined
  for (const groups of parsed) {
    if (!groups || groups.a!.length === 4) continue
    const shown = groups.stamp!.replace(/[  ]/g, ' ')
    if (+groups.a! > 12) dayFirst ??= shown
    if (+groups.b! > 12) monthFirst ??= shown
  }
  if (dayFirst && monthFirst) {
    throw new Stop(
      `The dates of this export are both day first and month first: ${dayFirst} and ${monthFirst}. ` +
        'One export has one order. Check that the file was not edited or joined from two exports.',
    )
  }
  if (dayFirst) return 'day-first'
  if (monthFirst) return 'month-first'
  if (parsed.some((groups) => groups && groups.a!.length !== 4)) {
    throw new Stop(
      'No date in this export shows whether it is day first or month first (none has a number above 12). ' +
        'Run again with --date-order day-first or --date-order month-first.',
    )
  }
  return 'day-first'
}

type Clock = { year: number; month: number; day: number; hour: number; minute: number; second: number }

function clockOf(groups: Groups, order: DateOrder): Clock | undefined {
  const [a, b, c] = [+groups.a!, +groups.b!, +groups.c!]
  let year: number, month: number, day: number
  if (groups.a!.length === 4) [year, month, day] = [a, b, c]
  else if (order === 'day-first') [day, month, year] = [a, b, c]
  else [month, day, year] = [a, b, c]
  if (groups.c!.length === 3) return undefined
  if (groups.a!.length !== 4 && groups.c!.length === 2) year += 2000

  let hour = +groups.h!
  const marker = groups.tr ? (groups.tr === 'ÖS' ? 'pm' : 'am') : groups.en?.toLowerCase() === 'p' ? 'pm' : groups.en ? 'am' : undefined
  if (marker) {
    if (hour < 1 || hour > 12) return undefined
    hour = (hour % 12) + (marker === 'pm' ? 12 : 0)
  }
  return { year, month, day, hour, minute: +groups.m!, second: +(groups.s || 0) }
}

function isRealClockTime(c: Clock) {
  if (c.month < 1 || c.month > 12 || c.hour > 23 || c.minute > 59 || c.second > 59 || c.day < 1) return false
  return c.day <= new Date(Date.UTC(c.year, c.month, 0)).getUTCDate()
}

// An attachment is a tag "<attached: file>" anywhere in the message (the word differs by language,
// so only its shape is matched), or Android's "file (file attached)". Caption text is what is left.
// Without media in the export, WhatsApp writes "image omitted" and the like instead.
function readAttachment(body: string): { kind: MediaKind | 'sticker'; name?: string; caption: string } | undefined {
  const text = body.replaceAll(lrm, '')
  const tag = /<[^<>:\n]+: ([^<>\n]+)>/.exec(text)
  if (tag) {
    const name = tag[1]!.trim()
    return { kind: kindOf(name), name, caption: withoutFileName(text.replace(tag[0], '').trim(), name) }
  }

  const android = /^(.+?) \((?:file attached|dosya ekli)\)\s*([\s\S]*)$/.exec(text.trim())
  if (android) return { kind: kindOf(android[1]!), name: android[1]!, caption: android[2]! }

  // Android does not say what kind of media is missing. The iPhone says so, after the invisible
  // mark, so a friend who types the same words is not mistaken for WhatsApp.
  if (androidOmitted.test(text.trim())) return { kind: 'document', caption: '' }
  const omitted = omittedLine.exec(body)
  if (omitted) return { kind: omittedKinds[omitted[1]!.toLowerCase()]!, caption: '' }
  return undefined
}

const androidOmitted = /^<(?:media omitted|medya dahil edilmedi|medya atlanmış)>$/i
const omittedKinds: Record<string, MediaKind | 'sticker'> = {
  image: 'photo',
  'görüntü': 'photo',
  video: 'video',
  gif: 'gif',
  audio: 'voice',
  ses: 'voice',
  sticker: 'sticker',
  'çıkartma': 'sticker',
  document: 'document',
  belge: 'document',
  'contact card': 'document',
  'kişi kartı': 'document',
}
const omittedLine = new RegExp(`${lrm}(${Object.keys(omittedKinds).join('|')}) (?:omitted|dahil edilmedi)$`, 'i')

// A photo sent as a document has its file name in front of the tag: "IMG_0412.HEIC <attached: ...>".
function withoutFileName(caption: string, name: string): string {
  const original = name.replace(/^\d+-/, '')
  return caption.startsWith(original) ? caption.slice(original.length).replace(/^ •[^\n]*/, '').trim() : caption
}

function kindOf(name: string): MediaKind | 'sticker' {
  const tag = /^\d+-([A-Z]+)-/.exec(name)?.[1] ?? /^([A-Z]{3})-\d{8}-WA\d+/.exec(name)?.[1]
  if (tag === 'PHOTO' || tag === 'IMG') return 'photo'
  if (tag === 'VIDEO' || tag === 'VID') return 'video'
  if (tag === 'GIF') return 'gif'
  if (tag === 'AUDIO' || tag === 'PTT' || tag === 'AUD') return 'voice'
  if (tag === 'STICKER' || tag === 'STK') return 'sticker'
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
// invisible left-to-right mark. A message someone wrote never does. Android has no such mark:
// its notices have no sender, and deleted-message notices are recognised by their words.
const deleted = /^(this message was deleted\.?|you deleted this message\.?|bu mesaj silindi\.?|bu mesajı sildiniz\.?)$/i

function isNotice(body: string): boolean {
  return body.startsWith(lrm) || deleted.test(body.trim())
}

// A notice on Android has no sender, so one with ": " inside it (a group renamed to "Kamp: Abant")
// reads like a message. What comes before the colon then holds the words of a notice.
const noticeHead =
  /\b(?:changed the subject|changed this group's|changed the group|changed their phone number|created group|joined using|added you|removed you)\b|konuyu .+ değiştirdi|grubunu oluşturdu|davet bağlantısını|sizi ekledi/i

// A shared location is not kept: the same on both phones, and nothing to show.
const location = /^(?:location|konum): https?:\/\/\S+$|^live location shared$/i

function isLocation(body: string): boolean {
  return location.test(body.trim())
}
