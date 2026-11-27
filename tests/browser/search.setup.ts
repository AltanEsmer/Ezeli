import { expect, test } from '@playwright/test'
import { appendFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { makeSmallExport } from './large.ts'
import { ownerCommand } from './support.ts'

const people = 'tests/fixtures/whatsapp-iphone/people.json'

function load(dir: string, chat: string) {
  try {
    const result = ownerCommand(['import', dir, '--people', people, '--timezone', 'Europe/Istanbul', '--chat', chat, '--date-order', 'day-first'])
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the search chats are imported', async () => {
  // Turkish words in every form: dotted and dotless i, in capitals and not, and ş ğ ü ö ç.
  load(
    await makeSmallExport([
      { when: '01.03.2022, 10:00:00', text: 'İstanbul akşamı' },
      { when: '02.03.2022, 10:00:00', text: 'ISTANBUL SAHİLİ' },
      { when: '03.03.2022, 10:00:00', text: 'ıstanbul boğazı' },
      { when: '04.03.2022, 10:00:00', text: 'istanbul köprüsü' },
      { when: '05.03.2022, 10:00:00', text: 'Şarkı söyledik' },
      { when: '06.03.2022, 10:00:00', text: 'ÇİĞ KÖFTE yedik' },
      { when: '07.03.2022, 10:00:00', text: 'yüzde 50 indirim_var \\ ve 100%' },
      { when: '08.03.2022, 10:00:00', text: 'Şeftali topladık' },
      { when: '09.03.2022, 10:00:00', text: 'gece yürüyüşü' },
      { when: '10.03.2022, 10:00:00', text: 'Café açıldı' },
    ]),
    'Arama Sohbeti',
  )
  const deep = await makeSmallExport([{ when: '17.03.2022, 10:00:00', text: 'pusula yeni rota dağlarda' }])
  appendFileSync(join(deep, '_chat.txt'), [
    ...Array.from({ length: 14 }, (_, i) => `[17.03.2022, 10:01:${String(i).padStart(2, '0')}] Limon L: Context ${i}`),
    `[17.03.2022, 10:02:00] Limon L: Pusula ${'çok uzun bir ara '.repeat(10)}Pusula rota ilk`,
    '[17.03.2022, 10:02:01] Limon L: Pusula rota ikinci',
    ...Array.from({ length: 9 }, (_, i) => `[17.03.2022, 10:03:${String(i).padStart(2, '0')}] Limon L: Later context ${i}`),
    '',
  ].join('\n'))
  load(deep, 'Deep Search')
  // More memories than one page of results, all with the same word.
  load(
    await makeSmallExport(Array.from({ length: 30 }, (_, i) => ({ when: `${String(i + 1).padStart(2, '0')}.05.2021, 12:00:00`, text: `Deniz kenarı ${i + 1}` }))),
    'Deniz Sohbeti',
  )
  // More than a hundred matches, so the database looks for candidates more than once for a page.
  const start = Date.UTC(2020, 0, 1)
  const stamp = (i: number) => new Date(start + i * 86_400_000).toISOString().slice(0, 10).split('-').reverse().join('.')
  load(await makeSmallExport(Array.from({ length: 130 }, (_, i) => ({ when: `${stamp(i)}, 09:00:00`, text: `Kıyı yürüyüşü ${i + 1}` }))), 'Kıyı Sohbeti')
})
