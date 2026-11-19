// The made-up album of the memory-list tests, imported once (not by every worker of the tests,
// which would race to make the same people): June 2016, before the large archive starts.
import { expect, test } from '@playwright/test'
import { ownerCommand } from './support.ts'

const fixtures = 'tests/fixtures/whatsapp-iphone'

test('the album is imported', () => {
  const result = ownerCommand(['import', `${fixtures}/album`, '--people', `${fixtures}/people.json`, '--timezone', 'Europe/Istanbul', '--chat', 'Yaz Albümü', '--date-order', 'day-first'])
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
})
