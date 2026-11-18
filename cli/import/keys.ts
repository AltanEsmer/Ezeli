// Lasting keys. An export has no message ids, so a message is known by its content: the chat,
// the clock time as written in the export cut to the minute (never the time zone or UTC), the
// person's fixed id from the people file (never the display name), what it carried, and how many
// identical ones came before it in the chat ("tamam" twice in a minute is two messages).
// Media leaves the text and the kind out, so an edited caption stays the same photo, and its
// position is among that person's media in that minute. Photo file names are not used: they differ between
// phones. Importing a newer export of the same chat gives the same keys for the same messages.
//
// Every key is made with a secret that belongs to the chat (made at its first import, stored where
// signed-in people cannot read it). Without it a friend could work a key out from what they can
// read (the chat's name, a person's id, the minute) and learn from its position that something else
// was sent in that minute. A chat stored before the secret existed has none and keeps its keys.
import { createHash, createHmac } from 'node:crypto'
import type { ChatApp } from './people.ts'

const hasher = (secret?: string) => (...parts: (string | number)[]) =>
  (secret ? createHmac('sha256', secret) : createHash('sha256')).update(parts.join('\u0001')).digest('hex').slice(0, 32)

// The app and the name the owner gave, ignoring case and spaces around it.
export function chatKey(app: ChatApp, name: string): string {
  return `${app}:${name.normalize('NFC').trim().toLowerCase()}`
}

// A message or attachment that the chat app gives a lasting id of its own (Discord): the key is
// made from the chat and that id alone, so editing the text or importing a newer export changes nothing.
export function idKey(chat: string, id: string, secret?: string): string {
  return hasher(secret)(chat, 'id', id)
}

// Call it once per message of the chat, in chat order, left-out senders already removed.
export function messageKeys(chat: string, secret?: string) {
  const hash = hasher(secret)
  const seen = new Map<string, number>()
  return (message: { minute: string; personId: string; text: string; media?: { kind: string } }): string => {
    // Any media counts alike: the iPhone says "image omitted" where Android only says "media
    // omitted", and a file that is there on one phone is missing on the other. So media is
    // known by its place among that person's media in that minute, not by its kind or text.
    const media = message.media !== undefined
    const same = hash(chat, message.minute, message.personId, media ? 'media' : '', media ? '' : message.text)
    const count = (seen.get(same) ?? 0) + 1
    seen.set(same, count)
    return hash(same, count)
  }
}
