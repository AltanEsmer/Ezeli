// The import seam, for every form of WhatsApp export the owners may meet: the real command runs
// on made-up exports and what it prints is checked. Nothing here saves, so no database is needed.
import { expect, test } from 'vitest'
import { makeExport, trial, variants } from './exports.ts'

const iphone = `${variants}/iphone-turkish`
const android = `${variants}/android-english`

test('a Turkish iPhone export: photos, omitted photo, HEIC photo, notices, numbers and mentions', () => {
  const result = trial(iphone, '--details')

  expect(result.err).toBe('')
  expect(result.status).toBe(0)
  expect(result.out).toBe(
    [
      'Trial run. Nothing was saved.',
      '',
      'Memories:    2',
      'Photos:      3',
      'People:      5 (Çilek, Fıstık, İncir, Karpuz, Limon)',
      'Date range:  2019-08-03 to 2019-08-05',
      'Problems:    1',
      '  - Photo missing from the export: no file in the export (Fıstık, 2019-08-03 09:17)',
      '',
      '  1. 2019-08-03 09:16  2 photos, 7 messages  Çilek, Fıstık, İncir, Karpuz, Limon',
      '       09:15  Karpuz: Günaydın! Çadırı kim getiriyor?',
      '                      Liste:',
      "                      3.08.2019 sabahı yola çıkıyoruz, İstanbul'dan",
      '       09:16  Limon: [Photo: 00000005-PHOTO-2019-08-03-09-16-30.jpg]',
      '       09:16  Limon: [Photo: 00000006-PHOTO-2019-08-03-09-16-41.jpg] Göl kenarı, ışığa bakın',
      '       09:17  Fıstık: [Photo missing from the export]',
      '       09:20  Fıstık: [Video]',
      '       09:21  Çilek: [Voice message]',
      '       09:22  İncir: @Fıstık odunları unutma, beni numarasından ara',
      '       09:22  İncir: tamam',
      '       09:22  İncir: tamam',
      '',
      '  2. 2019-08-05 00:01  1 photo, 0 messages  Karpuz',
      '       00:01  Karpuz: [Photo: 00000017-IMG_0412.HEIC]',
      '',
    ].join('\n'),
  )
})

test('an Android export: the text file is found, media without a kind and phone numbers are handled', () => {
  const result = trial(android, '--details')

  expect(result.err).toBe('')
  expect(result.status).toBe(0)
  expect(result.out).toBe(
    [
      'Trial run. Nothing was saved.',
      '',
      'Memories:    1',
      'Photos:      1',
      'People:      5 (Çilek, Fıstık, İncir, Karpuz, Limon)',
      'Date range:  2019-08-03 to 2019-08-03',
      'Problems:    none',
      '',
      '  1. 2019-08-03 09:16  1 photo, 8 messages  Çilek, Fıstık, İncir, Karpuz, Limon',
      '       09:15  Karpuz: Günaydın! Çadırı kim getiriyor?',
      '                      Liste:',
      "                      8/3/19 sabahı yola çıkıyoruz, İstanbul'dan",
      '       09:16  Limon: [Photo: IMG-20190803-WA0004.jpg] Göl kenarı, ışığa bakın',
      '       09:17  Fıstık: [Document]',
      '       09:20  Fıstık: [Video]',
      '       09:21  Çilek: [Voice message]',
      '       09:22  İncir: @İncir odunları unutma, sen de gel',
      '       09:22  İncir: tamam',
      '       09:22  İncir: tamam',
      '       09:27  Karpuz: [Document]',
      '',
    ].join('\n'),
  )
})

// 3 August 2019, 21:16, written the way each kind of phone writes it. A second, earlier line
// has a number above 12, which is what decides day-first or month-first for the whole export.
const phones: { name: string; layout: 'iphone' | 'android'; decider: string; photo: string }[] = [
  { name: 'Turkey 24-hour iPhone', layout: 'iphone', decider: '[28.07.2019 18:02:11]', photo: '[3.08.2019 21:16:30]' },
  { name: 'Turkey 12-hour iPhone', layout: 'iphone', decider: '[28.07.2019 ÖS 06:02:11]', photo: '[3.08.2019 ÖS 09:16:30]' },
  { name: 'Turkey with a comma, dotted clock', layout: 'iphone', decider: '[28.07.2019, 18.02.11]', photo: '[03.08.2019, 21.16.30]' },
  { name: 'United States 12-hour iPhone', layout: 'iphone', decider: '[7/28/19, 6:02:11 PM]', photo: '[8/3/19, 9:16:30 PM]' },
  { name: 'United States 12-hour, narrow no-break space', layout: 'android', decider: '7/28/19, 6:02\u202fPM - ', photo: '8/3/19, 9:16\u202fPM - ' },
  { name: 'United States 24-hour Android', layout: 'android', decider: '7/28/19, 18:02 - ', photo: '8/3/19, 21:16 - ' },
  { name: 'United Kingdom 24-hour Android', layout: 'android', decider: '28/07/2019, 18:02 - ', photo: '03/08/2019, 21:16 - ' },
  { name: 'United Kingdom 12-hour, lower case', layout: 'android', decider: '28/07/2019, 06:02 pm - ', photo: '03/08/2019, 09:16 pm - ' },
  { name: 'Germany Android', layout: 'android', decider: '28.07.19, 18:02 - ', photo: '03.08.19, 21:16 - ' },
  { name: 'dots in a.m. and p.m.', layout: 'android', decider: '28/07/2019, 6:02 p.m. - ', photo: '03/08/2019, 9:16 p.m. - ' },
  { name: 'year first', layout: 'android', decider: '2019/07/28, 18:02 - ', photo: '2019/08/03, 21:16 - ' },
  { name: 'dashes in the date', layout: 'android', decider: '28-07-2019 18:02 - ', photo: '03-08-2019 21:16 - ' },
]

for (const phone of phones) {
  test(`dates as ${phone.name} phone writes them are read, ${phone.layout} layout`, async () => {
    const attach = phone.layout === 'iphone' ? '\u200e<attached: IMG_1.jpg>' : 'IMG_1.jpg (file attached)'
    const chat = [`${phone.decider} Karpuz K: selam`, `${phone.photo} Limon L: ${attach}`, ''].join('\n')
    const folder = await makeExport(chat, { android: phone.layout === 'android', photos: ['IMG_1.jpg'] })

    const result = trial(folder, '--details')

    expect(result.err).toBe('')
    expect(result.out).toContain('Date range:  2019-08-03 to 2019-08-03')
    expect(result.out).toContain('  1. 2019-08-03 21:16  1 photo, 0 messages  Limon')
  })
}

test('12 at night is hour 0 and 12 at noon is hour 12', async () => {
  const chat = [
    '7/28/19, 6:02 PM - Karpuz K: selam',
    '8/5/19, 12:01 AM - Limon L: IMG_1.jpg (file attached)',
    '8/5/19, 12:30 PM - Fıstık F: IMG_2.jpg (file attached)',
    '',
  ].join('\n')
  const folder = await makeExport(chat, { android: true, photos: ['IMG_1.jpg', 'IMG_2.jpg'] })

  const result = trial(folder)

  expect(result.out).toContain('  1. 2019-08-05 00:01  1 photo, 0 messages  Limon')
  expect(result.out).toContain('  2. 2019-08-05 12:30  1 photo, 0 messages  Fıstık')
})

test('a date that does not decide the order stops the run and asks for an option', async () => {
  const chat = ['5/3/19, 6:02 PM - Karpuz K: selam', '6/4/19, 9:16 PM - Limon L: IMG_1.jpg (file attached)', ''].join('\n')
  const folder = await makeExport(chat, { android: true, photos: ['IMG_1.jpg'] })

  const stopped = trial(folder)
  expect(stopped.status).toBe(1)
  expect(stopped.out).toBe('')
  expect(stopped.err).toContain('--date-order day-first')
  expect(stopped.err).toContain('--date-order month-first')

  expect(trial(folder, '--date-order', 'month-first').out).toContain('2019-06-04 21:16')
  expect(trial(folder, '--date-order', 'day-first').out).toContain('2019-04-06 21:16')
  const wrong = trial(folder, '--date-order', 'sideways')
  expect(wrong.status).toBe(1)
  expect(wrong.err).toContain('--date-order must be day-first or month-first')
})

test('the order is decided once for the export, not per line', async () => {
  // 3/4/19 could be either on its own. The 14th on another line makes the whole file month-first.
  const chat = [
    '3/4/19, 6:02 PM - Karpuz K: IMG_1.jpg (file attached)',
    '3/14/19, 6:03 PM - Limon L: IMG_2.jpg (file attached)',
    '',
  ].join('\n')
  const folder = await makeExport(chat, { android: true, photos: ['IMG_1.jpg', 'IMG_2.jpg'] })

  const result = trial(folder)

  expect(result.status).toBe(0)
  expect(result.out).toContain('Date range:  2019-03-04 to 2019-03-14')
})

test('dates that disagree about the order stop the run', async () => {
  const chat = ['13/4/19, 6:02 PM - Karpuz K: selam', '3/14/19, 6:03 PM - Limon L: selam', ''].join('\n')
  const folder = await makeExport(chat, { android: true })

  const result = trial(folder)

  expect(result.status).toBe(1)
  expect(result.err).toContain('day first and month first')
})

test('a date that cannot exist in the decided order still stops the run and names the line', async () => {
  const chat = ['28/07/2019, 6:02 PM - Karpuz K: selam', '31/02/2019, 6:03 PM - Limon L: selam', ''].join('\n')
  const folder = await makeExport(chat, { android: true })

  const result = trial(folder)

  expect(result.status).toBe(1)
  expect(result.err).toContain('Line 2: 31/02/2019, 6:03 PM is not a day-first date and time.')
})

test('an export folder with no chat text, or with two, says what to give', async () => {
  const empty = await makeExport('x', { android: true })
  const two = await makeExport('7/28/19, 6:02 PM - Karpuz K: selam\n', { android: true })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(`${two}/notes.txt`, 'something else')

  const none = trial(`${variants}/no-such-folder`)
  expect(none.err).toContain('No _chat.txt in')
  const unreadable = trial(empty)
  expect(unreadable.err).toContain('has no messages')
  const picked = trial(two)
  expect(picked.status).toBe(0)
})

test('a sender that is a phone number is named by display name, and no phone number is printed', async () => {
  const chat = [
    '7/28/19, 6:02 PM - Karpuz K: selam',
    '8/3/19, 9:16 PM - \u202a+90 500 000 00 01\u202c: IMG_1.jpg (file attached)',
    '8/3/19, 9:17 PM - \u202a+90 500 000 00 77\u202c: bir de ben',
    '',
  ].join('\n')
  const folder = await makeExport(chat, { android: true, photos: ['IMG_1.jpg'] })

  const result = trial(folder)

  expect(result.status).toBe(1)
  expect(result.out).toBe('')
  expect(result.err).toContain('Not in the people file: a phone number (first message 2019-08-03 21:17)')
  expect(result.err).not.toMatch(/500|\b77\b/)
})

test('phone numbers in message text are removed, dates, times, prices and years are not', async () => {
  const text = [
    'ara +90 500 000 00 05 olur',
    'ya da 0532 000 00 06, 0 532 000 00 07',
    '5320000008 de olur',
    '905000000009 yazılı',
    '(212) 555-0101 veya 212-555-0102',
    '14.07.2023 saat 20:58, 1.250,50 TL, 2023-07-14, 1 500 000 TL, 2019 2020 2021',
  ].join('\n')
  const chat = ['7/28/19, 6:02 PM - Karpuz K: hazır', '8/3/19, 9:15 PM - Karpuz K: ' + text, '8/3/19, 9:16 PM - Limon L: IMG_1.jpg (file attached)', ''].join('\n')
  const folder = await makeExport(chat, { android: true, photos: ['IMG_1.jpg'] })

  const result = trial(folder, '--details')

  expect(result.status).toBe(0)
  expect(result.out).not.toMatch(/\+90|0532|0 532|5320000008|905000000009|555/)
  expect(result.out).toContain('ara olur')
  expect(result.out).toContain('14.07.2023 saat 20:58, 1.250,50 TL, 2023-07-14, 1 500 000 TL, 2019 2020 2021')
})

test('a phone number is matched however the people file writes it', async () => {
  const chat = [
    '7/28/19, 6:02 PM - Karpuz K: hazır',
    '8/3/19, 9:15 PM - \u202a0500 000 00 01\u202c: selam',
    '8/3/19, 9:16 PM - Limon L: IMG_1.jpg (file attached)',
    '',
  ].join('\n')
  const folder = await makeExport(chat, { android: true, photos: ['IMG_1.jpg'] })

  const result = trial(folder, '--details')

  // The people file has +90 500 000 00 01, which is the same number without the 0 and with the country code.
  expect(result.out).toContain('Çilek: selam')
})

test('a Turkish Android export: its own words for attached and omitted media, and a ~ sender', async () => {
  const chat = [
    '28.07.2019 18:02 - Karpuz K: selam',
    '3.08.2019 09:15 - Karpuz K: hazırlanın',
    '3.08.2019 09:16 - Limon L: IMG-20190803-WA0004.jpg (dosya ekli)',
    'Göl kenarı',
    '3.08.2019 09:17 - ~\u202fFıstık F: <Medya dahil edilmedi>',
    '3.08.2019 09:18 - Karpuz K: <Medya atlanmış>',
    '3.08.2019 09:19 - Karpuz K: Bu mesaj silindi',
    '3.08.2019 09:20 - Limon L: media omitted',
    '',
  ].join('\n')
  const folder = await makeExport(chat, { android: true, photos: ['IMG-20190803-WA0004.jpg'] })

  const result = trial(folder, '--details')

  expect(result.err).toBe('')
  expect(result.out).toContain('1 photo, 4 messages  Fıstık, Karpuz, Limon')
  expect(result.out).toContain('Fıstık: [Document]')
  expect(result.out).toContain('Karpuz: [Document]')
  expect(result.out).toContain('Limon: media omitted')
  expect(result.out).not.toContain('silindi')
})
