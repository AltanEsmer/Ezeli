// Grouping: which photos and messages of one chat form a memory. The same rules for every chat app.
import type { Media } from './chat.ts'

export type Grouping = {
  photoGapMinutes: number // photos closer together than this share a memory
  beforeMinutes: number // messages this long before the first photo belong to the memory
  afterMinutes: number // messages this long after the last photo belong to the memory
  maxMessages: number // at most this many messages on each side
}

export const startingGrouping: Grouping = {
  photoGapMinutes: 30,
  beforeMinutes: 15,
  afterMinutes: 30,
  maxMessages: 30,
}

// `key` is the message's lasting key (see keys.ts).
// `person` is the display name, `personId` the fixed id from the people file.
export type MemoryMessage = { key: string; at: number; person: string; personId: string; text: string; media?: Media }
export type Memory = { at: number; messages: MemoryMessage[] } // `at` is when the first photo was sent

// A photo message starts and holds a memory whether or not its file is in the export or can be
// read: the memory's key is its first photo message.
export function isPhoto(message: MemoryMessage): boolean {
  return message.media?.kind === 'photo'
}

// A photo message whose file is there to be stored.
export function hasPhotoFile(message: MemoryMessage): boolean {
  return message.media?.kind === 'photo' && message.media.file !== undefined
}

// `messages` are one chat's messages in chat order, with left-out senders already removed.
export function buildMemories(messages: MemoryMessage[], grouping: Grouping): Memory[] {
  const minutes = 60_000
  const time = (index: number) => messages[index]!.at

  // 1. Photos close together form one run, whoever sent them.
  const runs: { first: number; last: number }[] = []
  messages.forEach((message, index) => {
    if (!isPhoto(message)) return
    const run = runs.at(-1)
    if (run && message.at - time(run.last) < grouping.photoGapMinutes * minutes) run.last = index
    else runs.push({ first: index, last: index })
  })

  // 2. Each run takes the messages shortly before its first photo, but none from before the
  //    previous run's last photo.
  const starts = runs.map((run, n) => {
    const floor = n === 0 ? 0 : runs[n - 1]!.last + 1
    const earliest = time(run.first) - grouping.beforeMinutes * minutes
    let start = run.first
    while (start > floor && run.first - (start - 1) <= grouping.maxMessages && time(start - 1) >= earliest) {
      start--
    }
    return start
  })

  // 3. Each run takes the messages shortly after its last photo, and stops where the next
  //    memory starts.
  return runs.map((run, n) => {
    const ceiling = starts[n + 1] ?? messages.length
    const latest = time(run.last) + grouping.afterMinutes * minutes
    let end = run.last + 1
    while (end < ceiling && end - run.last <= grouping.maxMessages && time(end) <= latest) end++
    return { at: time(run.first), messages: messages.slice(starts[n], end) }
  })
}
