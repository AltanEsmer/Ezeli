import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'

test('running ezeli without a command shows how to use it', () => {
  const result = spawnSync('node', ['cli/ezeli.ts'], { encoding: 'utf8' })

  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Usage: pnpm ezeli <command>')
})
