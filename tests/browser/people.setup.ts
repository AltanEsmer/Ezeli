// More chats for the people tests, imported once (see memory.setup.ts): two chats in different
// time zones whose newest memories are on days that differ from the same moments in UTC, and a
// chat in which a person is only named in someone else's text. Karpuz sends the photos and Limon
// writes the text (large.ts).
import { rmSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { makeSmallExport } from './large.ts'
import { ownerCommand } from './support.ts'

const people = 'tests/fixtures/whatsapp-iphone/people.json'

test('the people chats are imported', async () => {
  const chats = [
    // 22:30 UTC on 13 January: the 14th in Istanbul. 04:30 UTC on 21 January: the 20th in New York.
    { name: 'Saat Dilimi İstanbul', zone: 'Europe/Istanbul', memories: [{ when: '14.01.2024, 01:30:00', text: 'Gece yarısından sonra' }] },
    { name: 'Saat Dilimi New York', zone: 'America/New_York', memories: [{ when: '20.01.2024, 23:30:00', text: 'Gece yarısından önce' }] },
    // Çilek is named in the text but sends nothing in this memory.
    { name: 'Anılan Kişi', zone: 'Europe/Istanbul', memories: [{ when: '18.01.2024, 12:00:00', text: 'Çilek bunu görmeli' }] },
  ]
  for (const { name, zone, memories } of chats) {
    const dir = await makeSmallExport(memories)
    try {
      const result = ownerCommand(['import', dir, '--people', people, '--timezone', zone, '--chat', name])
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})
