// What the review of the WhatsApp variants found, one test each, at the import seam: the real
// command runs on made-up exports (fake numbers, fruit nicknames) and what it prints is checked.
import { expect, test } from 'vitest'
import { makeExport, peopleOf, trialWith, variants } from './exports.ts'

const karpuz = { id: 'karpuz', name: 'Karpuz', whatsapp: ['Karpuz K', 'Karpuz'] }
const limon = { id: 'limon', name: 'Limon', whatsapp: ['Limon L', 'Limon'] }
const baran = { id: 'baran', name: 'Baran Eski', whatsapp: ['Baran', '+90 500 000 00 02'], leftOut: true }
const kerem = { id: 'kerem', name: 'Kerem', whatsapp: ['Kerem A'] }
const people = peopleOf([karpuz, limon, baran, kerem])
const mention = (name: string) => `@\u2068${name}\u2069`
const decider = '7/28/19, 6:02 PM - Karpuz: hazır'
const photo = '8/3/19, 9:16 AM - Limon: IMG_1.jpg (file attached)'

async function android(...lines: string[]) {
  return makeExport([decider, ...lines, photo, ''].join('\n'), { android: true, photos: ['IMG_1.jpg'] })
}

test('1: a left-out person or someone unknown is removed from a mention, name and all, on both layouts', async () => {
  const fromAndroid = await android(
    '8/3/19, 9:15 AM - Karpuz: @905000000002 odunları unutma',
    '8/3/19, 9:15 AM - Karpuz: @905000000042 sen de gel',
  )
  const fromIphone = await makeExport(
    [
      '[28.07.2019 18:02:11] Karpuz K: hazır',
      `[3.08.2019 09:15:00] Karpuz K: ${mention('Baran')} odunları unutma`,
      `[3.08.2019 09:15:01] Karpuz K: ${mention('Zeynep Komşu')} sen de gel`,
      `[3.08.2019 09:15:02] Karpuz K: ${mention('Kerem A')} bak`,
      '\u200e[3.08.2019 09:16:30] Limon L: \u200e<attached: IMG_1.jpg>',
      '',
    ].join('\r\n'),
    { photos: ['IMG_1.jpg'] },
  )

  for (const folder of [fromAndroid, fromIphone]) {
    const result = trialWith(people, folder, '--details')
    expect(result.status, result.err).toBe(0)
    expect(result.out).toContain('Karpuz: odunları unutma\n')
    expect(result.out).toContain('Karpuz: sen de gel\n')
    for (const gone of ['Baran', 'Eski', 'Zeynep', 'Komşu', '9050000']) expect(result.out).not.toContain(gone)
  }
  expect(trialWith(people, fromIphone, '--details').out).toContain('Karpuz: @Kerem bak\n')
})

test('2: phone numbers typed in a message are removed in the forms people write them', async () => {
  const removed = [
    '+90 (532) 000 00 01',
    '0 (532) 000 00 02',
    '(0532) 000 00 08',
    '0216 000 00 09',
    '07700 900123',
    '+49 30 12345678',
    '+33 6 12 34 56 78',
    '+1 212 555 0101',
    '0532.000.00.05',
    '905320000004',
  ]
  const kept = [
    '1 500 000 000 TL',
    '12.345.678.901 TL',
    '$ 1 500 000 000',
    '12345678901234',
    'AB12345678901',
    'TR12 0006 2000 0001 2345 6789 01',
    '14.07.2023 saat 20:58, 2023-07-14 20:58',
    '2019 2020 2021',
    '40.000000,30.000000',
  ]
  const text = [...removed.map((n) => `ara ${n} olur`), 'iki satır +90 532\n000 00 13 olur', ...kept.map((k) => `kalsın ${k} tamam`)].join('\n')
  const folder = await android(`8/3/19, 9:15 AM - Karpuz: ${text}`)

  const result = trialWith(people, folder, '--details')

  expect(result.status, result.err).toBe(0)
  for (const number of removed) expect(result.out, number).not.toContain(number.replace(/^\+90 /, ''))
  expect(result.out).not.toContain('000 00 13')
  expect(result.out).toContain('ara olur')
  for (const keep of kept) expect(result.out, keep).toContain(`kalsın ${keep} tamam`)
})

test('3: the unknown-sender list prints senders as written, warns, and prints no message text', async () => {
  const folder = await makeExport(
    [
      '7/28/19, 6:02 PM - Karpuz: hazır',
      '8/3/19, 9:15 AM - Usta 0532 000 00 09: gizli mesaj 1',
      '8/3/19, 9:15 AM - Komşu (+90 532 000 00 10): gizli mesaj 2',
      '8/3/19, 9:16 AM - \u202a+90 500 000 00 77\u202c: gizli mesaj 3',
      '',
    ].join('\n'),
    { android: true },
  )

  const result = trialWith(people, folder)

  expect(result.status).toBe(1)
  expect(result.out).toBe('')
  const [warning, list] = result.err.split('\n')
  expect(warning).toBe('This list is exactly as written in the export. It can hold phone numbers: do not paste it anywhere.')
  expect(list).toContain('Usta 0532 000 00 09')
  expect(list).toContain('Komşu (+90 532 000 00 10)')
  expect(list).toContain('+90 500 000 00 77')
  expect(result.err).not.toContain('gizli')
})

test('4: a date-shaped line a friend typed stays in its message, with or without a name', async () => {
  const folder = await makeExport(
    [
      '28.07.2019 18:02 - Karpuz: hazır',
      '3.08.2019 09:15 - Karpuz: Dönüş planı:',
      '1.08.2019 09:00 - otobüs kalkar',
      '1.08.2019 10:00 - Limon: ben gelirim',
      'unutmayın',
      '3.08.2019 09:16 - Limon: IMG_1.jpg (file attached)',
      '',
    ].join('\n'),
    { android: true, photos: ['IMG_1.jpg'] },
  )

  const result = trialWith(people, folder, '--details')

  expect(result.status, result.err).toBe(0)
  expect(result.out).toContain('Date range:  2019-08-03 to 2019-08-03')
  expect(result.out).toContain('Problems:    none')
  expect(result.out).toContain('Karpuz: Dönüş planı:\n                      1.08.2019 09:00 - otobüs kalkar\n                      1.08.2019 10:00 - Limon: ben gelirim\n                      unutmayın\n')
})

test('4: a typed line cannot decide the date order; dates that contradict each other stop the run', async () => {
  const folder = await makeExport(
    [
      '8/3/19, 9:15 AM - Karpuz: Dönüş planı:',
      '15/08/2019 09:00 - otobüs kalkar',
      '8/3/19, 9:16 AM - Limon: IMG_1.jpg (file attached)',
      '',
    ].join('\n'),
    { android: true, photos: ['IMG_1.jpg'] },
  )

  const stopped = trialWith(people, folder)
  expect(stopped.status).toBe(1)
  expect(stopped.out).toBe('')
  expect(stopped.err).toContain('--date-order')

  const chosen = trialWith(people, folder, '--date-order', 'month-first', '--details')
  expect(chosen.out).toContain('1. 2019-08-03 09:16')
  expect(chosen.out).toContain('Karpuz: Dönüş planı:\n                      15/08/2019 09:00 - otobüs kalkar\n')
})

test('5: lines with a date and no sender that are no known notice are listed, not lost silently', async () => {
  const folder = await makeExport(
    [
      '7/28/19, 6:02 PM - Karpuz: hazır',
      '8/3/19, 9:16 AM - Limon: IMG_1.jpg (file attached)',
      '8/3/19, 9:17 AM - Karpuz: Yarınki plan:',
      '8/4/19, 9:00 AM - Kahvaltı',
      '8/4/19, 11:30 AM - Göle yürüyüş',
      '8/4/19, 11:45 AM - Kerem A left',
      '',
    ].join('\n'),
    { android: true, photos: ['IMG_1.jpg'] },
  )

  const result = trialWith(people, folder, '--date-order', 'month-first')

  expect(result.status, result.err).toBe(0)
  expect(result.out).toContain('2 lines with a date and time but no sender were skipped as notices')
  expect(result.out).not.toContain('Kahvaltı')
})

test('6: a sender is matched exactly as written: ~ Name only when the file lists it, a number in full', async () => {
  const chat = (...senders: string[]) =>
    makeExport(
      [decider, ...senders.map((s) => `8/3/19, 9:15 AM - ${s}: selam`), photo, ''].join('\n'),
      { android: true, photos: ['IMG_1.jpg'] },
    )
  const withNumbers = peopleOf([
    karpuz,
    { ...limon, whatsapp: [...limon.whatsapp, '~ Limon L'] },
    { id: 'cilek', name: 'Çilek', whatsapp: ['+90 500 000 00 01', '0500 000 00 01'] },
  ])

  const other = trialWith(people, await chat('~\u202fKarpuz K'))
  expect(other.status).toBe(1)
  expect(other.err).toContain('~ Karpuz K')

  const listed = trialWith(withNumbers, await chat('~\u202fLimon L'), '--details')
  expect(listed.status, listed.err).toBe(0)

  const forms = trialWith(withNumbers, await chat('+90 500 000 00 01', '0500-000-00-01', '(0500) 000 00 01', '905000000001'), '--details')
  expect(forms.status, forms.err).toBe(0)
  expect(forms.out).toContain('Çilek: selam')

  const otherCountry = trialWith(withNumbers, await chat('+1 500 000 0001'))
  expect(otherCountry.status).toBe(1)
  expect(otherCountry.err).toContain('Not in the people file')
})

test('7: typed text that looks like an attachment stays text', async () => {
  const folder = await makeExport(
    [
      decider,
      '8/3/19, 9:15 AM - Karpuz: <Not: yarın gelmiyorum>',
      '8/3/19, 9:15 AM - Karpuz: bunu gördün mü (file attached)',
      '8/3/19, 9:15 AM - Karpuz: Saat <bence: 5.jpg> gibi',
      '8/3/19, 9:15 AM - Karpuz: foto.jpg (file attached)',
      photo,
      '',
    ].join('\n'),
    { android: true, photos: ['IMG_1.jpg', 'foto.jpg'] },
  )

  const result = trialWith(people, folder, '--details')

  expect(result.status, result.err).toBe(0)
  expect(result.out).toContain('Problems:    none')
  expect(result.out).toContain('Karpuz: <Not: yarın gelmiyorum>\n')
  expect(result.out).toContain('Karpuz: bunu gördün mü (file attached)\n')
  expect(result.out).toContain('Karpuz: Saat <bence: 5.jpg> gibi\n')
  expect(result.out).toContain('Karpuz: [Photo: foto.jpg]\n')
  expect(result.out).toContain('2 photos,')
})

test('9: a subject change with a colon in it is a notice, in English and in Turkish', async () => {
  const chat = [
    decider,
    '8/3/19, 9:15 AM - Karpuz changed the subject from "Kamp" to "Kamp: Abant"',
    '8/3/19, 9:15 AM - Karpuz, konuyu "Kamp" iken "Kamp: Abant" olarak değiştirdi',
    '8/3/19, 9:15 AM - Karpuz created group "Kamp: Abant"',
    '8/3/19, 9:15 AM - Karpuz, "Kamp: Abant" grubunu oluşturdu',
    photo,
    '',
  ]
  const fromAndroid = await makeExport(chat.join('\n'), { android: true, photos: ['IMG_1.jpg'] })
  const fromIphone = await makeExport(
    [
      '[28.07.2019 18:02:11] Karpuz K: hazır',
      '[3.08.2019 09:15:00] \u200eKarpuz changed the subject from "Kamp" to "Kamp: Abant"',
      '[3.08.2019 09:15:01] \u200eKarpuz, konuyu "Kamp" iken "Kamp: Abant" olarak değiştirdi',
      '\u200e[3.08.2019 09:16:30] Limon L: \u200e<attached: IMG_1.jpg>',
      '',
    ].join('\r\n'),
    { photos: ['IMG_1.jpg'] },
  )

  for (const folder of [fromAndroid, fromIphone]) {
    const result = trialWith(people, folder)
    expect(result.status, result.err).toBe(0)
    expect(result.out).toContain('Problems:    none')
  }
})

test('8: media that Android did not export is shown as media, never as a document or photo', async () => {
  const folder = await android('8/3/19, 9:15 AM - Karpuz: <Media omitted>')

  const result = trialWith(people, folder, '--details')

  expect(result.out).toContain('Karpuz: [Media not in the export]')
  expect(result.out).toContain('Problems:    none')
})

test('10: a JPEG that is named .heic is read, a HEIC is recognised by its content, not its name', async () => {
  const folder = await makeExport(
    [decider, '8/3/19, 9:15 AM - Limon: IMG_1.heic (file attached)', '8/3/19, 9:16 AM - Limon: IMG_2.jpg (file attached)', ''].join('\n'),
    { android: true, photos: ['IMG_1.heic'], copies: { 'IMG_2.jpg': `${variants}/rotated.heic` } },
  )

  const result = trialWith(people, folder)

  expect(result.status, result.err).toBe(0)
  expect(result.out).toContain('Photos:      2')
  expect(result.out).toContain('Problems:    none')
})
