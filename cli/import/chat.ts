// What an export of any chat app is read into. Readers (WhatsApp, later Discord) produce this;
// people and grouping work on it and know nothing about the chat app's file format.
import type { ChatApp } from './people.ts'

export type MediaKind = 'photo' | 'video' | 'gif' | 'voice' | 'document'

// `file` is the path of a photo found in the export. A photo without one is missing from the
// export. Other kinds are never imported, so they carry no file.
export type Media = { kind: MediaKind; name?: string; file?: string }

export type ChatMessage = {
  at: number // the moment it was sent, in milliseconds since 1970 UTC
  sender: string // the name or id exactly as the export has it
  text: string
  media?: Media
}

export type ChatExport = {
  app: ChatApp
  messages: ChatMessage[] // in the order of the chat; notices and stickers already skipped
  problems: string[]
}
