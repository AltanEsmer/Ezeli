// A large made-up export, written at test time (never committed): a few thousand memories over
// several years, with tiny photos of three shapes. The real import loads it.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

export const large = { chat: 'Büyük Albüm', memories: 2400 }

const people = ['Karpuz K', 'Limon L', 'Fıstık F']
const shapes = [
  { width: 64, height: 48 },
  { width: 48, height: 64 },
  { width: 56, height: 56 },
]
const pad = (n: number) => String(n).padStart(2, '0')
const LRM = '‎'

// Memory `i` is the i-th, oldest first: one every 27 hours from 2017, with one to three photos
// five minutes apart, a text before the first photo and one after the last.
export async function makeLargeExport(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'ezeli-large-'))
  mkdirSync(dir, { recursive: true })
  const pictures = await Promise.all(
    shapes.map(({ width, height }, i) =>
      sharp({ create: { width, height, channels: 3, background: { r: 60 + i * 70, g: 120, b: 200 - i * 60 } } })
        .jpeg()
        .toBuffer(),
    ),
  )
  const lines: string[] = []
  const start = Date.UTC(2017, 0, 5, 10, 0, 0)
  let file = 0
  for (let i = 0; i < large.memories; i += 1) {
    const base = start + i * 27 * 3600_000
    const stamp = (extra: number) => {
      const d = new Date(base + extra * 60_000)
      return `[${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00]`
    }
    lines.push(`${stamp(-5)} ${people[(i + 1) % 3]}: Anı ${i} öncesi`)
    const count = (i % 3) + 1
    for (let p = 0; p < count; p += 1) {
      file += 1
      const name = `${String(file).padStart(8, '0')}-PHOTO.jpg`
      writeFileSync(join(dir, name), pictures[(i + p) % 3]!)
      lines.push(`${LRM}${stamp(p * 5)} ${people[(i + p) % 3]}: ${LRM}<attached: ${name}>`)
    }
    lines.push(`${stamp(count * 5 + 2)} ${people[(i + 2) % 3]}: Anı ${i} sonrası`)
  }
  writeFileSync(join(dir, '_chat.txt'), `${lines.join('\n')}\n`)
  return dir
}
