// The people file: who is who in each chat app. The format is described in docs/import.md.
import { readFileSync } from 'node:fs'
import { Stop } from './stop.ts'

export type ChatApp = 'whatsapp' | 'discord'
// `id` is the fixed id from the people file (a lowercase slug the owners choose once and never
// change): lasting keys and the saved person are made from it, not from the display name.
export type Person = { id: string; name: string; leftOut: boolean }
// `others` are more names of the same sender to try after the first (a Discord account id comes
// first, then its username and nickname).
export type People = { find: (app: ChatApp, sender: string, others?: string[]) => Person | undefined }

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
  if (isRecord(content)) {
    for (const key of Object.keys(content)) {
      if (key !== 'people') throw new Stop(`The people file has an unknown key "${key}". ${seeDocs}`)
    }
  }
  if (!Array.isArray(entries)) throw new Stop(`The people file needs a "people" list. ${seeDocs}`)

  const bySender = new Map<string, Person>()
  const names = new Set<string>()
  const ids = new Set<string>()
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name.trim() === '') {
      throw new Stop(`Every person in the people file needs a "name". ${seeDocs}`)
    }
    const id = entry.id
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      throw new Stop(
        `${entry.name.trim()} in the people file needs an "id": a short lowercase word, such as "karpuz", chosen once and never changed. ${seeDocs}`,
      )
    }
    if (ids.has(id)) throw new Stop(`The people file has the id "${id}" twice.`)
    ids.add(id)
    const person: Person = { id, name: entry.name.trim(), leftOut: entry.leftOut === true }
    for (const key of Object.keys(entry)) {
      if (!allowedKeys.includes(key)) {
        throw new Stop(`${person.name} in the people file has an unknown key "${key}". Allowed: ${allowedKeys.join(', ')}.`)
      }
    }
    if (entry.leftOut !== undefined && typeof entry.leftOut !== 'boolean') {
      throw new Stop(`"leftOut" of ${person.name} must be true or false, without quotes.`)
    }
    if (names.has(person.name)) throw new Stop(`The people file has the name "${person.name}" twice.`)
    names.add(person.name)

    for (const app of Object.keys(appNames) as ChatApp[]) {
      const senders = entry[app] ?? []
      if (!Array.isArray(senders) || senders.some((sender) => typeof sender !== 'string' || cleanSender(sender) === '')) {
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

  return {
    find: (app, sender, others = []) =>
      [sender, ...others].map((name) => bySender.get(senderKey(app, name))).find((person) => person !== undefined),
  }
}

const allowedKeys = ['id', 'name', 'whatsapp', 'discord', 'leftOut']
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
