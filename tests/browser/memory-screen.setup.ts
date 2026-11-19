// The evening by the sea of the memory-screen tests, imported once (not by every worker of the tests,
// which would race to make the same people): Yaz Gecesi, 21 July 2018, four photos in a conversation
// of 19 messages that passes midnight. It runs last, as it adds a memory and the earlier tests count them.
import { expect, test } from '@playwright/test'
import { ownerCommand } from './support.ts'

const fixtures = 'tests/fixtures/whatsapp-iphone'

test('the evening by the sea is imported', () => {
  // A wider window around the photos than the default, so that all 19 messages are one memory's.
  const result = ownerCommand(['import', `${fixtures}/gather`, '--people', `${fixtures}/people.json`, '--timezone', 'Europe/Istanbul', '--chat', 'Yaz Gecesi', '--date-order', 'day-first', '--before', '60', '--after', '120'])
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
})
