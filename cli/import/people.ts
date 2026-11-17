// The people file: who is who in each chat app. The format is described in docs/import.md.
import { readFileSync } from 'node:fs'
import { Stop } from './stop.ts'

export type ChatApp = 'whatsapp' | 'discord'
export type Person = { name: string; leftOut: boolean }
export type People = { find: (app: ChatApp, sender: string) => Person | undefined }

const appNames: Record<ChatApp, string> = { whatsapp: 'WhatsApp', discord: 'Discord' }

export function readPeople(file: string): People {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    throw new Stop(`Cannot read the people file: ${file}`)
  }
  let content: unknown
  try {
    content = JSON.parse(text)
  } catch (error) {
    throw new Stop(`The people file is not valid JSON: ${(error as Error).message}`)
  }

  const entries = isRecord(content) ? content.people : undefined
  if (!Array.isArray(entries)) throw new Stop(`The people file needs a "people" list. ${seeDocs}`)

  const bySender = new Map<string, Person>()
  const names = new Set<string>()
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name.trim() === '') {
      throw new Stop(`Every person in the people file needs a "name". ${seeDocs}`)
    }
    const person: Person = { name: entry.name.trim(), leftOut: entry.leftOut === true }
    if (names.has(person.name)) throw new Stop(`The people file has the name "${person.name}" twice.`)
    names.add(person.name)

    for (const app of Object.keys(appNames) as ChatApp[]) {
      const senders = entry[app] ?? []
      if (!Array.isArray(senders) || senders.some((sender) => typeof sender !== 'string')) {
        throw new Stop(`"${app}" of ${person.name} in the people file must be a list of sender names. ${seeDocs}`)
      }
      for (const sender of senders as string[]) {
        const key = senderKey(app, sender)
        if (bySender.has(key)) {
          throw new Stop(`The people file lists the ${appNames[app]} sender "${sender}" twice.`)
        }
        bySender.set(key, person)
      }
    }
  }

  return { find: (app, sender) => bySender.get(senderKey(app, sender)) }
}

const seeDocs = 'See docs/import.md.'

// Chat apps wrap some names in invisible direction marks and use odd spaces. A sender is the
// same sender with or without them.
export function cleanSender(sender: string): string {
  return sender
    .normalize('NFC')
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function senderKey(app: ChatApp, sender: string): string {
  return `${app}:${cleanSender(sender)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
