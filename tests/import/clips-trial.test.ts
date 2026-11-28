import { spawnSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { expect, test } from 'vitest'
import { clipPeople, makeClipExport } from '../clip-export.ts'

test('the trial previews eligible clips and explains skips without saving anything', async () => {
  const { dir } = await makeClipExport()
  try {
    const files = readdirSync(dir)
    const result = spawnSync(process.execPath, ['cli/ezeli.ts', 'import', dir, '--people', clipPeople, '--timezone', 'UTC', '--trial'], {
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' },
    })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Trial run. Nothing was saved.')
    expect(result.stdout).toContain('Clips: 4 playable, 3 skipped.')
    expect(result.stdout).toContain('video is over two minutes')
    expect(result.stdout).toContain('audio has no reliable voice-note marker')
    expect(result.stdout).toContain('file missing from export')
    expect(readdirSync(dir)).toEqual(files)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 60_000)
