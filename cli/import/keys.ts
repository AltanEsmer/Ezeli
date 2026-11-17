// Lasting keys. An export has no message ids, so a message is known by its chat, the moment it
// was sent, who sent it, what it carried and how many identical ones came before it (two
// "tamam" in the same minute are two messages). Photo file names are not used: they differ
// between phones. The keys are made from the chat's content, so importing a newer export of
// the same chat gives the same keys for the same messages.
import { createHash } from 'node:crypto'
import type { ChatApp } from './people.ts'

const hash = (...parts: (string | number)[]) =>
  createHash('sha256').update(parts.join('\u0001')).digest('hex').slice(0, 32)

// The app and the name the owner gave, ignoring case and spaces around it.
export function chatKey(app: ChatApp, name: string): string {
  return `${app}:${name.normalize('NFC').trim().toLowerCase()}`
}

// Call it once per message of the chat, in chat order, left-out senders already removed.
export function messageKeys(chat: string) {
  const seen = new Map<string, number>()
  return (message: { at: number; person: string; text: string; media?: { kind: string } }): string => {
    const same = hash(chat, message.at, message.person, message.media?.kind ?? '', message.text)
    const count = (seen.get(same) ?? 0) + 1
    seen.set(same, count)
    return hash(same, count)
  }
}
