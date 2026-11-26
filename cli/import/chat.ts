// What an export of any chat app is read into. Readers (WhatsApp, later Discord) produce this;
// people and grouping work on it and know nothing about the chat app's file format.
import type { Clip } from './clips.ts'
import type { ChatApp } from './people.ts'

// `media` is Android's "media omitted": it does not say what was sent.
export type MediaKind = 'photo' | 'video' | 'gif' | 'voice' | 'document' | 'media'

// `file` is the path of a photo or clip found in the export.
// `hash` is the hash of the original file's bytes, made when saving, so a hidden photo can be found again.
export type Media = { kind: MediaKind; name?: string; file?: string; hash?: string; ambiguousAudio?: boolean; clip?: Clip }

export type ChatMessage = {
  at: number // the moment it was sent, in milliseconds since 1970 UTC
  minute: string // the clock time as written in the export, cut to the minute: "2023-07-14 20:58"
  sender: string // the name or id exactly as the export has it
  text: string
  media?: Media
  // Discord only: the chat app's own lasting id of this message or attachment. Keys are made from
  // it instead of from the content, and `sender` is the account id. `names` (server name, username)
  // are only printed for the owner when the sender is unknown; they are never stored.
  // `mentions` are the accounts mentioned in the text, as `@name`.
  id?: string
  names?: string[]
  mentions?: { id: string; names: string[] }[]
}

export type ChatExport = {
  app: ChatApp
  messages: ChatMessage[] // in the order of the chat; notices and stickers already skipped
  problems: string[] // about the export as a whole; problems about a message are worked out from `messages`
}
