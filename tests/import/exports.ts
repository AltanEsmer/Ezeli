// Helpers for the import seam that need no database: made-up WhatsApp exports written to a new
// folder, and the real command run on them as a trial.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

export const variants = 'tests/fixtures/whatsapp-variants'
export const variantPeople = `${variants}/people.json`

export function trial(folder: string, ...options: string[]) {
  const result = spawnSync(
    'node',
    ['cli/ezeli.ts', 'import', folder, '--people', variantPeople, '--timezone', 'Europe/Istanbul', '--trial', ...options],
    { encoding: 'utf8' },
  )
  return { status: result.status, out: result.stdout, err: result.stderr }
}

// A made-up export in a new folder: the chat text as given, and a small real photo for each name.
// `android` picks the layout: a text file named like Android's, or `_chat.txt` like the iPhone's.
export async function makeExport(chat: string, options: { android?: boolean; photos?: string[] } = {}): Promise<string> {
  const folder = mkdtempSync(join(tmpdir(), 'ezeli-variant-'))
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, options.android ? 'WhatsApp Chat with Kamp Ekibi.txt' : '_chat.txt'), chat)
  for (const name of options.photos ?? []) {
    await sharp({ create: { width: 24, height: 16, channels: 3, background: '#d9a441' } }).jpeg().toFile(join(folder, name))
  }
  return folder
}
