// The large made-up export is made and loaded with the real import, once, after the other tests.
import { rmSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { large, makeLargeExport } from './large.ts'
import { ownerCommand } from './support.ts'

test('the large made-up export is imported', async () => {
  test.setTimeout(900_000)
  const dir = await makeLargeExport()
  try {
    const result = ownerCommand(['import', dir, '--people', 'tests/fixtures/whatsapp-iphone/people.json', '--timezone', 'Europe/Istanbul', '--chat', large.chat])
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
