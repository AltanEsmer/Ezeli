// The large made-up archive is made and loaded with the real import, once, after the other tests.
import { rmSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { large, makeLargeExport, makeSmallExport } from './large.ts'
import { ownerCommand } from './support.ts'

const people = 'tests/fixtures/whatsapp-iphone/people.json'

function load(dir: string, chat: string, timezone: string) {
  try {
    const result = ownerCommand(['import', dir, '--people', people, '--timezone', timezone, '--chat', chat])
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the large made-up archive is imported', async () => {
  test.setTimeout(900_000)
  load(await makeLargeExport(), large.chat, 'Europe/Istanbul')

  // More memories at the very same moment than fit in a page: one chat each, all at 12:00 on
  // 15 June 2020, so they share their clock time and only the lasting key tells them apart.
  for (let n = 1; n <= large.ties; n += 1) {
    load(await makeSmallExport([{ when: '15.06.2020, 12:00:00', text: `Eş ${n}` }]), `Eş Zamanlı ${n}`, 'Europe/Istanbul')
  }

  // Two chats in different time zones with memories on the same days around midnight of 31 March
  // 2021: by their clock times they are March and April, in one order, though the moments differ.
  load(await makeSmallExport([{ when: '31.03.2021, 23:50:00', text: 'İstanbul mart' }, { when: '01.04.2021, 00:20:00', text: 'İstanbul nisan' }]), 'Gece Yarısı İstanbul', 'Europe/Istanbul')
  load(await makeSmallExport([{ when: '31.03.2021, 23:55:00', text: 'New York mart' }, { when: '01.04.2021, 00:10:00', text: 'New York nisan' }]), 'Gece Yarısı New York', 'America/New_York')
})
