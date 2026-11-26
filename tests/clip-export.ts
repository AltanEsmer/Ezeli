import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

export const clipPeople = 'tests/fixtures/whatsapp-iphone/people.json'

export async function makeClipExport() {
  const dir = mkdtempSync(join(tmpdir(), 'ezeli-clip-export-'))
  const file = (name: string) => join(dir, name)
  await sharp({ create: { width: 64, height: 48, channels: 3, background: 'orange' } }).jpeg().toFile(file('IMG-20221121-WA0001.jpg'))
  const video = (name: string, duration: number) => execFileSync('ffmpeg', [
    '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=1',
    '-t', String(duration), '-c:v', 'mpeg4', file(name),
  ])
  const first = 'VID-20221121-WA0002.mp4'
  video(first, 2)
  copyFileSync(file(first), file('VID-20221121-WA0003.mp4'))
  video('VID-20221121-WA0004.mp4', 120)
  video('VID-20221121-WA0005.mp4', 121)
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000',
    '-t', '121', '-c:a', 'libopus', file('PTT-20221121-WA0006.opus')])
  copyFileSync(file('PTT-20221121-WA0006.opus'), file('AUD-20221121-WA0007.opus'))
  writeFileSync(file('_chat.txt'), [
    '21.11.2022, 10:00 - Karpuz K: IMG-20221121-WA0001.jpg (file attached)',
    `21.11.2022, 10:01 - Karpuz K: ${first} (file attached)`,
    'First clip caption',
    '21.11.2022, 10:01 - Karpuz K: VID-20221121-WA0003.mp4 (file attached)',
    'Second clip caption',
    '21.11.2022, 10:02 - Karpuz K: VID-20221121-WA0004.mp4 (file attached)',
    '21.11.2022, 10:03 - Karpuz K: VID-20221121-WA0005.mp4 (file attached)',
    '21.11.2022, 10:04 - Karpuz K: PTT-20221121-WA0006.opus (file attached)',
    '21.11.2022, 10:05 - Karpuz K: AUD-20221121-WA0007.opus (file attached)',
    '21.11.2022, 10:06 - Karpuz K: VID-20221121-WA0008.mp4 (file attached)',
    '',
  ].join('\n'))
  return { dir, first: file(first) }
}
