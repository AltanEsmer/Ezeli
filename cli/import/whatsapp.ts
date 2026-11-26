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
const lrm = '\u200e'
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

const audioFile = /\.(?:opus|m4a|mp3|aac|ogg|amr|wav|flac)$/i
const photoFile = /\.(jpe?g|png|heic|heif)$/i

export function readWhatsApp(folder: string, zone: string, chosenOrder?: DateOrder): ChatExport {
  const chatFile = findChatFile(folder)
  const lines = readFileSync(chatFile, 'utf8').replace(/^\ufeff/, '').split(/\r?\n/)
  const folderFiles = readdirSync(folder)
    .filter((name) => join(folder, name) !== chatFile && !name.startsWith('.') && statSync(join(folder, name)).isFile())
    .map((name) => name.normalize('NFC'))
  const present = new Set(folderFiles)
  const isFile = (name: string) => present.has(name.normalize('NFC')) || whatsAppFileName.test(name)

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

  // 2. Which lines are headers, and day first or month first. A line is a header when it has the
  // header shape and its time is not earlier than the header before it (a little disorder is
  // allowed). A line a friend typed, such as a plan with dates, stays in its message. The order is
  // decided once, by the order under which the real headers fit best.
  const scanned = chosenOrder ? scan(parsed, chosenOrder, zone) : decide(parsed, zone)
  const order = scanned.order
  const problems: string[] = []
  if (scanned.bad.length > 0) {
    // Between brackets a date that cannot exist is a mistake, not typed text. Otherwise the line stays in its message.
    const first = scanned.bad[0]!
    if (header === headers.bracket) {
      throw new Stop(`Line ${first + 1}: ${parsed[first]!.stamp!.replace(/[\u202f\u00a0]/g, ' ')} is not a ${order} date and time.`)
    }
    const count = scanned.bad.length === 1 ? '1 line looks' : `${scanned.bad.length} lines look`
    problems.push(`${count} like a date and time that cannot exist (${order}) and stayed in the message above.`)
  }

  // 3. Cut the file into entries. A line that is not a header continues the entry before it.
  const entries: { at: number; minute: string; rest: string[] }[] = []
  lines.forEach((line, index) => {
    const found = scanned.accepted.get(index)
    if (!found) {
      entries.at(-1)?.rest.push(line)
      return
    }
    entries.push({ at: found.at, minute: found.minute, rest: [parsed[index]!.rest!] })
  })

  // 4. Read each entry.
  const messages: ChatMessage[] = []
  const referenced = new Set<string>()
  let photoMessages = 0
  let unknownNotices = 0
  for (const { at, minute, rest } of entries) {
    const entry = rest.join('\n').replace(/\s+$/, '')
    // A notice with no sender starts with the invisible mark on an iPhone.
    if (entry.startsWith(lrm)) continue
    const split = entry.indexOf(': ')
    if (split < 0) {
      // A notice has no sender. A line of typed text that looks like a header has none either.
      if (entry !== '' && !knownNotice.test(entry)) unknownNotices++
      continue
    }
    // A notice that has ": " inside, such as a new group name, reads like a message.
    if (noticeHead.test(entry.slice(0, split)) || colonNotice.some((notice) => notice.test(entry.split('\n')[0]!))) continue
    const sender = cleanSender(entry.slice(0, split))
    const body = entry.slice(split + 2).replace(edited, '')

    const attachment = readAttachment(body, isFile)
    if (attachment) {
      if (attachment.name) referenced.add(attachment.name.normalize('NFC'))
      if (attachment.kind === 'sticker') continue
      const media: Media = { kind: attachment.kind }
      if (attachment.name) media.name = attachment.name
      const eligible = media.kind === 'photo' || media.kind === 'voice' || media.kind === 'video'
      if (media.kind === 'photo') photoMessages++
      if (attachment.name && audioFile.test(attachment.name) && media.kind !== 'voice') media.ambiguousAudio = true
      if (eligible && attachment.name && present.has(attachment.name.normalize('NFC'))) media.file = join(folder, attachment.name)
      messages.push({ at, minute, sender, text: eligible ? attachment.caption : '', media })
    } else if (!isNotice(body) && !isLocation(body)) {
      messages.push({ at, minute, sender, text: body })
    }
  }

  // Exports are sometimes slightly out of order. Sort by time; the sort keeps file order for ties.
  messages.sort((a, b) => a.at - b.at)

  // 5. Guard against a layout this reader does not know: files nobody refers to.
  if (unknownNotices > 0) {
    const count = unknownNotices === 1 ? '1 line with a date and time but no sender was' : `${unknownNotices} lines with a date and time but no sender were`
    problems.push(`${count} skipped as notices (no known notice wording). They may be typed text.`)
  }
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
  const missing = new Stop(`No _chat.txt in ${folder} (iPhone export) and no .txt chat file (Android). Give the unzipped export folder.`)
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

type Scan = { order: DateOrder; accepted: Map<number, { at: number; minute: string }>; bad: number[]; late: number }

// Reads the header-shaped lines in one order. `bad` are lines whose date or time cannot exist,
// `late` those that are earlier than the header before them. Both stay in the message above.
function scan(parsed: (Groups | undefined)[], order: DateOrder, zone: string): Scan {
  const slack = 60 * 60_000
  const accepted = new Map<number, { at: number; minute: string }>()
  const bad: number[] = []
  let late = 0
  let latest = -Infinity
  parsed.forEach((groups, index) => {
    if (!groups) return
    const clock = clockOf(groups, order)
    if (!clock || !isRealClockTime(clock)) {
      bad.push(index)
      return
    }
    const at = momentOf(clock, zone)
    if (at < latest - slack) {
      late++
      return
    }
    latest = Math.max(latest, at)
    const two = (n: number) => String(n).padStart(2, '0')
    accepted.set(index, { at, minute: `${clock.year}-${two(clock.month)}-${two(clock.day)} ${two(clock.hour)}:${two(clock.minute)}` })
  })
  return { order, accepted, bad, late }
}

// "3.08.2019" is 3 August in a day-first export and 8 March in a month-first one. Both are tried;
// the order under which fewer lines are impossible or out of time order is the export's. A tie
// means the dates cannot say, and the owner is asked. A year first date needs no deciding.
function decide(parsed: (Groups | undefined)[], zone: string): Scan {
  const day = scan(parsed, 'day-first', zone)
  const month = scan(parsed, 'month-first', zone)
  const score = (result: Scan) => result.bad.length + result.late
  if (!parsed.some((groups) => groups && groups.a!.length !== 4)) return day
  if (score(day) !== score(month)) return score(day) < score(month) ? day : month
  const evidence = { day: false, month: false }
  for (const groups of parsed) {
    if (!groups || groups.a!.length === 4) continue
    if (+groups.a! > 12) evidence.day = true
    if (+groups.b! > 12) evidence.month = true
  }
  throw new Stop(
    (evidence.day && evidence.month
      ? 'The dates of this export are both day first and month first, so one export has one order. '
      : score(day) > 0
        ? 'The dates of this export do not fit one order. '
        : 'No date in this export shows whether it is day first or month first (none has a number above 12). ') +
      'Run again with --date-order day-first or --date-order month-first.',
  )
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
function readAttachment(body: string, isFile: (name: string) => boolean): { kind: MediaKind | 'sticker'; name?: string; caption: string } | undefined {
  const text = body.replaceAll(lrm, '')
  const tag = /<[^<>:\n]+: ([^<>\n]+)>/.exec(text)
  // Only a file name that WhatsApp writes, or a file that is in the folder, makes it media.
  // Typed words such as "<Not: yarın gelmiyorum>" or "bunu gördün mü (file attached)" stay text.
  if (tag && isFile(tag[1]!.trim())) {
    const name = tag[1]!.trim()
    return { kind: kindOf(name), name, caption: withoutFileName(text.replace(tag[0], '').trim(), name) }
  }

  const android = /^(.+?) \((?:file attached|dosya ekli)\)\s*([\s\S]*)$/.exec(text.trim())
  if (android && isFile(android[1]!)) return { kind: kindOf(android[1]!), name: android[1]!, caption: android[2]! }

  // Android does not say what kind of media is missing. The iPhone says so, after the invisible
  // mark, so a friend who types the same words is not mistaken for WhatsApp.
  if (androidOmitted.test(text.trim())) return { kind: 'media', caption: '' }
  const omitted = omittedLine.exec(body)
  if (omitted) return { kind: omittedKinds[omitted[1]!.toLowerCase()]!, caption: '' }
  return undefined
}

// File names as WhatsApp writes them (see docs/import.md): iPhone `00000042-PHOTO-2020-06-07-15-13-20.jpg`,
// a document `00000051-Rapor.pdf`, the older `2015-08-04-PHOTO-00004762.jpg`; Android
// `IMG-20210428-WA0001.jpg`, or a hex name.
const whatsAppFileName =
  /^(?:\d{8}-(?:(?:PHOTO|VIDEO|AUDIO|STICKER|GIF)-\d{4}(?:-\d\d){5}\.\w+|.+\.\w{2,5})|\d{4}-\d\d-\d\d-[A-Z]+-\d{8}\.\w+|(?:IMG|VID|PTT|AUD|STK|DOC)-\d{8}-WA\d{4}\.\w+|[0-9a-f]{32}\.\w+)$/

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
  if (tag === 'PTT' || /^\d{8}-AUDIO-\d{4}(?:-\d\d){5}\.opus$/i.test(name)) return 'voice'
  if (tag === 'STICKER' || tag === 'STK') return 'sticker'
  const extension = name.split('.').at(-1)!.toLowerCase()
  if (['jpg', 'jpeg', 'png', 'heic', 'heif'].includes(extension)) return 'photo'
  if (['mp4', 'mov', '3gp'].includes(extension)) return 'video'
  if (extension === 'webp') return 'sticker'
  return 'document'
}

// The marker WhatsApp adds at the end of an edited message.
const edited = /\s*\u200e?<(?:This message was edited|Bu mesaj düzenlendi)>\s*$/i

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

// Whole lines of notices that have a colon inside, in English and Turkish: a group renamed or made.
const colonNotice = [
  /^.+ changed the subject from ".*" to ".*"$/,
  /^.+ created group ".*"$/,
  /^.+,? ".*" grubunu oluşturdu$/,
  /^.+,? konuyu ".*" iken ".*" olarak değiştirdi$/,
]

// Notices without a sender that the reader knows. Anything else with a date and no sender is
// reported, as it may be text a friend typed.
const knownNotice =
  /end-to-end encrypt|uçtan uca şifrel|security code|güvenlik kodu|\bchanged\b|değiştirdi|created group|oluşturdu|\badded\b|ekledi|\bremoved\b|çıkardı|\bleft\b|ayrıldı|\bjoined\b|katıldı|disappearing messages|süreli mesaj|\bcall\b|arama|waiting for this message|bekleniyor|\badmin\b|yönetici|pinned|sabitledi|turned (?:on|off)|açtı|kapattı|invite link|davet bağlantı|\bdeleted\b|silindi|community|topluluk|requested to join|katılma isteği|live location|canlı konum/i

// A shared location is not kept: the same on both phones, and nothing to show.
const location = /^(?:location|konum): https?:\/\/\S+$|^live location shared$/i

function isLocation(body: string): boolean {
  return location.test(body.trim())
}
