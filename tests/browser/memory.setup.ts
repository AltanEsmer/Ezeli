// The chats the memory tests look at, imported once (not by every worker of the tests, which would
// race to make the same people).
import { expect, test } from '@playwright/test'
import { ownerCommand } from './support.ts'

const fixtures = 'tests/fixtures/whatsapp-iphone'

test('the memory chats are imported', () => {
  // Gezi Notları: 2 September 2023 and 10 January 2023 (passes midnight). İkiz A and B: one photo
  // each at the very same moment, 1 February 2023 10:00.
  for (const [folder, chat] of [['links', 'Gezi Notları'], ['twin', 'İkiz A'], ['twin', 'İkiz B']] as const) {
    const result = ownerCommand(['import', `${fixtures}/${folder}`, '--people', `${fixtures}/people.json`, '--timezone', 'Europe/Istanbul', '--chat', chat, '--date-order', 'day-first'])
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  }
  // An Android export (3 August 2019) with one line of media that is not in the export.
  const android = ownerCommand(['import', 'tests/fixtures/whatsapp-variants/android-english', '--people', 'tests/fixtures/whatsapp-variants/people.json', '--timezone', 'Europe/Istanbul', '--chat', 'Android Kamp'])
  expect(android.stderr).toBe('')
  expect(android.status).toBe(0)
})
