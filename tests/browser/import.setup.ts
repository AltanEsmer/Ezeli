// The memories of the browser tests come from running the real import on the made-up exports,
// once, before the tests that look at the timeline.
import { expect, test } from '@playwright/test'
import { ownerCommand } from './support.ts'

const fixtures = 'tests/fixtures/whatsapp-iphone'

const chats = [
  // Two memories: the 14th (two photos) and the 15th of July 2023.
  { name: 'Kaş Tatili', folder: 'weekend', extra: [] as string[] },
  // One memory of three photos from three people, on 5 March 2023: the photos are 30 minutes
  // apart, so a gap of 31 minutes joins them.
  { name: 'Mart Gezisi', folder: 'gaps', extra: ['--photo-gap', '31'] },
]

test('the made-up exports are imported', () => {
  for (const { name, folder, extra } of chats) {
    const result = ownerCommand(['import', `${fixtures}/${folder}`, '--people', `${fixtures}/people.json`, '--timezone', 'Europe/Istanbul', '--chat', name, ...extra])
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  }
})
