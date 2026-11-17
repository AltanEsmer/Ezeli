// Reads a Discord export made by DiscordChatExporter (JSON, with --utc and --media): a
// `messages.json` with the downloaded attachments in a folder next to it. How the owner makes it
// is in docs/import.md. Nobody has seen a real export yet; this follows the layout the tool's
// source describes, and stops with a plain message on a file that does not match it.
// Knows nothing about people or memories; it only turns the file into a ChatExport.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { ChatExport, ChatMessage, Media, MediaKind } from './chat.ts'
import { Stop } from './stop.ts'
import { momentText } from './time.ts'

type Json = Record<string, unknown>

// An ISO 8601 date and time that says its offset. A time without one would be read in this
// computer's zone, so it is refused.
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

// The folder holds a Discord export when it has a messages.json and no WhatsApp _chat.txt.
export function isDiscordExport(folder: string): boolean {
  return existsSync(join(folder, 'messages.json')) && !existsSync(join(folder, '_chat.txt'))
}

export function readDiscord(folder: string, zone: string): ChatExport {
  const file = join(folder, 'messages.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
  } catch (error) {
    throw new Stop(`${file} is not valid JSON (${(error as Error).message}). It should be the messages.json that DiscordChatExporter writes. See docs/import.md.`)
  }
  const mismatch = (what: string): never => {
    throw new Stop(`${file} does not match a DiscordChatExporter JSON export: ${what}. See docs/import.md.`)
  }
  if (!isObject(parsed)) return mismatch('it is not a JSON object')
  if (!Array.isArray(parsed.messages)) return mismatch('it has no "messages" list')

  const messages: ChatMessage[] = []
  parsed.messages.forEach((raw: unknown, index) => {
    if (!isObject(raw)) return mismatch(`message ${index + 1} is not an object`)
    const id = raw.id
    if (typeof id !== 'string' || id === '') return mismatch(`message ${index + 1} has no "id"`)
    const where = `message ${index + 1} (id ${id})`
    if (typeof raw.type !== 'string') return mismatch(`${where} has no "type"`)
    // Joins, pins, calls and the like are notices. Only real messages are read.
    if (raw.type !== 'Default' && raw.type !== 'Reply') return
    const author = raw.author
    if (!isObject(author)) return mismatch(`${where} has no "author"`)
    if (author.isBot === true) return
    if (typeof author.id !== 'string' || author.id === '') return mismatch(`${where} has no "author.id"`)
    if (typeof raw.timestamp !== 'string' || !timestamp.test(raw.timestamp) || Number.isNaN(Date.parse(raw.timestamp))) {
      return mismatch(`${where} has the time ${JSON.stringify(raw.timestamp)}, not a date and time with an offset such as "2023-07-14T17:58:11.120+00:00"`)
    }
    if (typeof raw.content !== 'string') return mismatch(`${where} has no "content" text`)
    if (!Array.isArray(raw.attachments)) return mismatch(`${where} has no "attachments" list`)

    const at = Date.parse(raw.timestamp)
    const base = {
      at,
      minute: momentText(at, zone),
      sender: author.id,
      names: [author.name, author.nickname].filter((name): name is string => typeof name === 'string' && name.trim() !== ''),
    }
    const text = raw.content
    const attachments = raw.attachments.map((item: unknown) => {
      if (!isObject(item) || typeof item.id !== 'string' || item.id === '') return mismatch(`${where} has an attachment without an "id"`)
      if (typeof item.fileName !== 'string' || item.fileName === '') return mismatch(`${where} has an attachment without a "fileName"`)
      if (typeof item.url !== 'string') return mismatch(`${where} has an attachment without a "url"`)
      return { id: item.id, fileName: item.fileName, url: item.url }
    })

    // Every attachment is a message of its own, with its own lasting id, so a photo keeps its
    // key however its message is edited. A caption goes with the first photo.
    const firstPhoto = attachments.findIndex((a) => kindOf(a.fileName) === 'photo')
    if (text.trim() !== '' && firstPhoto < 0) messages.push({ ...base, id: `message:${id}`, text })
    attachments.forEach((a, i) => {
      const kind = kindOf(a.fileName)
      const media: Media = { kind, name: a.fileName }
      // A photo that was not downloaded keeps its web address in `url`: it is missing media.
      if (kind === 'photo') {
        const found = localFile(folder, a.url)
        if (found) media.file = found
      }
      messages.push({ ...base, id: `attachment:${a.id}`, text: i === firstPhoto ? text : '', media })
    })
  })

  // Exports come oldest first; sorting keeps that order for messages of the same moment.
  messages.sort((a, b) => a.at - b.at)

  const problems: string[] = []
  if (typeof parsed.messageCount === 'number' && parsed.messageCount !== parsed.messages.length) {
    problems.push(`messages.json says it has ${parsed.messageCount} messages but lists ${parsed.messages.length}: the export may be cut off`)
  }
  return { app: 'discord', messages, problems }
}

// The file of an attachment: a path relative to the folder of messages.json. Tried as written and
// with web-address escapes (%20) undone. Never outside the folder.
function localFile(folder: string, url: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return undefined
  const root = resolve(folder)
  let decoded = url
  try {
    decoded = decodeURIComponent(url)
  } catch {
    // keep the text as written
  }
  for (const candidate of [url, decoded]) {
    const path = resolve(root, candidate)
    if (path.startsWith(root + sep) && existsSync(path) && statSync(path).isFile()) return path
  }
  return undefined
}

// An attachment has no media type in the export: the file name's extension decides.
const extensions: [MediaKind, string[]][] = [
  ['photo', ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']],
  ['video', ['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi', '3gp']],
  ['voice', ['ogg', 'opus', 'mp3', 'm4a', 'wav', 'aac', 'flac', 'amr']],
]

function kindOf(fileName: string): MediaKind {
  const extension = fileName.split('.').at(-1)!.toLowerCase()
  return extensions.find(([, list]) => list.includes(extension))?.[0] ?? 'document'
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
