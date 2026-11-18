// A large made-up archive, written at test time (never committed): a few thousand memories over
// eleven years in one chat, tiny photos of three shapes, and a few small chats that make the hard
// cases: more memories at the very same moment than fit in a page, and two chats in different
// time zones whose memories are on the same days. The real import loads all of it.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

export const large = { chat: 'Büyük Albüm', memories: 2400, years: 11, ties: 22 }

const people = ['Karpuz K', 'Limon L', 'Fıstık F']
const shapes = [
  { width: 64, height: 48 },
  { width: 48, height: 64 },
  { width: 56, height: 56 },
]
const pad = (n: number) => String(n).padStart(2, '0')
const LRM = '‎'

async function pictures(): Promise<Buffer[]> {
  return Promise.all(
    shapes.map(({ width, height }, i) =>
      sharp({ create: { width, height, channels: 3, background: { r: 60 + i * 70, g: 120, b: 200 - i * 60 } } })
        .jpeg()
        .toBuffer(),
    ),
  )
}

// The clock time as WhatsApp writes it, `[dd.mm.yyyy, hh:mm:ss]`, for a moment in UTC milliseconds.
const stamp = (ms: number) => {
  const d = new Date(ms)
  return `[${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00]`
}

// The big chat: memory `i` (oldest first) is one every 40 hours from 5 January 2017, with one to
// three photos five minutes apart, a text before the first photo and one after the last.
export async function makeLargeExport(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'ezeli-large-'))
  const shots = await pictures()
  const lines: string[] = []
  const start = Date.UTC(2017, 0, 5, 10, 0, 0)
  let file = 0
  for (let i = 0; i < large.memories; i += 1) {
    const base = start + i * 40 * 3600_000
    const at = (minutes: number) => stamp(base + minutes * 60_000)
    lines.push(`${at(-5)} ${people[(i + 1) % 3]}: Anı ${i} öncesi`)
    const count = (i % 3) + 1
    for (let p = 0; p < count; p += 1) {
      file += 1
      const name = `${String(file).padStart(8, '0')}-PHOTO.jpg`
      writeFileSync(join(dir, name), shots[(i + p) % 3]!)
      lines.push(`${LRM}${at(p * 5)} ${people[(i + p) % 3]}: ${LRM}<attached: ${name}>`)
    }
    lines.push(`${at(count * 5 + 2)} ${people[(i + 2) % 3]}: Anı ${i} sonrası`)
  }
  writeFileSync(join(dir, '_chat.txt'), `${lines.join('\n')}\n`)
  return dir
}

// A chat of single memories, each `[clock time as written, text after the photo]`.
export async function makeSmallExport(memories: { when: string; text: string }[]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'ezeli-small-'))
  mkdirSync(dir, { recursive: true })
  const [shot] = await pictures()
  const lines = memories.flatMap(({ when, text }, i) => {
    const name = `${String(i + 1).padStart(8, '0')}-PHOTO.jpg`
    writeFileSync(join(dir, name), shot!)
    return [`${LRM}[${when}] ${people[0]}: ${LRM}<attached: ${name}>`, `[${when}] ${people[1]}: ${text}`]
  })
  writeFileSync(join(dir, '_chat.txt'), `${lines.join('\n')}\n`)
  return dir
}
