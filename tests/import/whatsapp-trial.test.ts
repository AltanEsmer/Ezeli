import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'

const fixtures = 'tests/fixtures/whatsapp-iphone'
const people = `${fixtures}/people.json`

function ezeliImport(...args: string[]) {
  const result = spawnSync('node', ['cli/ezeli.ts', 'import', ...args], { encoding: 'utf8' })
  return { status: result.status, out: result.stdout, err: result.stderr }
}

// These made-up exports are day-first. Several have only dates that could be read either way,
// so the order is given (deciding it from the dates is tested in whatsapp-variants.test.ts).
function trial(folder: string, ...options: string[]) {
  return ezeliImport(`${fixtures}/${folder}`, '--people', people, '--timezone', 'Europe/Istanbul', '--trial', '--date-order', 'day-first', ...options)
}

test('a trial run prints the memories, photos, people, date range and problems', () => {
  const result = trial('weekend')

  expect(result.err).toBe('')
  expect(result.status).toBe(0)
  expect(result.out.split('\nClips:')[0]).toBe(
    [
      'Trial run. Nothing was saved.',
      '',
      'Memories:    2',
      'Photos:      3',
      'People:      3 (Fıstık, Karpuz, Limon)',
      'Date range:  2023-07-14 to 2023-07-15',
      'Problems:    none',
      '',
      '  1. 2023-07-14 20:58  2 photos, 7 messages  Fıstık, Karpuz, Limon',
      '  2. 2023-07-15 11:05  1 photo, 1 message  Fıstık, Karpuz',
      '',
    ].join('\n'),
  )
})

test('an import that is missing the folder, people file or time zone shows how to run it', () => {
  const usage = 'Usage: pnpm ezeli import <export folder> --people <file> --timezone <zone> --chat <name> [--trial]'

  for (const args of [
    ['--people', people, '--timezone', 'Europe/Istanbul', '--trial'],
    [`${fixtures}/weekend`, '--timezone', 'Europe/Istanbul', '--trial'],
    [`${fixtures}/weekend`, '--people', people, '--trial'],
    [`${fixtures}/weekend`, '--people', people, '--timezone', 'Europe/Istanbul', '--trail'],
  ]) {
    const result = ezeliImport(...args)
    expect(result.status).toBe(1)
    expect(result.err).toContain(usage)
  }
})

test('a time zone that does not exist stops the import', () => {
  const result = ezeliImport(`${fixtures}/weekend`, '--people', people, '--timezone', 'Europe/Atlantis', '--trial')

  expect(result.status).toBe(1)
  expect(result.err).toContain('Unknown time zone: Europe/Atlantis. Use a name such as Europe/Istanbul.')
})

test('a people file that cannot be read or is not in the documented shape stops the import', () => {
  const run = (file: string) =>
    ezeliImport(`${fixtures}/weekend`, '--people', `${fixtures}/${file}`, '--timezone', 'Europe/Istanbul', '--trial')

  const missing = run('no-such-people.json')
  expect(missing.status).toBe(1)
  expect(missing.err).toContain('Cannot read the people file')

  const notJson = run('people-not-json.json')
  expect(notJson.status).toBe(1)
  expect(notJson.err).toContain('The people file is not valid JSON')

  const twice = run('people-sender-twice.json')
  expect(twice.status).toBe(1)
  expect(twice.err).toContain('The people file lists the WhatsApp sender "Limon L" twice.')
})

test('without --trial the import needs a name for the chat', () => {
  const result = ezeliImport(`${fixtures}/weekend`, '--people', people, '--timezone', 'Europe/Istanbul')

  expect(result.status).toBe(1)
  expect(result.err).toContain('Saving needs a name for the chat.')
  expect(result.out).toBe('')
})

test('what the conversation of a memory holds, read from the made-up export', () => {
  const result = trial('weekend', '--details')

  expect(result.status).toBe(0)
  const conversation = result.out.split('\nClips:')[0]!.split('\n').slice(8)
  expect(conversation).toEqual([
    '  1. 2023-07-14 20:58  2 photos, 7 messages  Fıstık, Karpuz, Limon',
    '       20:47  Fıstık: Ben geldim bile 😎',
    '       20:50  Karpuz: İskeleye gelin',
    '                      gün batımı çok güzel',
    '',
    '                      şarj aletini unutmayın',
    '       20:58  Limon: [Photo: 00000007-PHOTO-2023-07-14-20-58-11.jpg]',
    '       20:59  Fıstık: Çok güzel çıkmış! Işık şahane',
    '       21:10  Karpuz: [Photo: 00000009-PHOTO-2023-07-14-21-10-05.jpg]',
    '       21:15  Fıstık: [Video]',
    '       21:20  Karpuz: [Voice message]',
    '       21:22  Fıstık: [Document]',
    '       21:25  Limon: Yarın tekneye gidiyoruz, unutmayın',
    '',
    '  2. 2023-07-15 11:05  1 photo, 1 message  Fıstık, Karpuz',
    '       11:05  Fıstık: [Photo: 00000020-PHOTO-2023-07-15-11-05-00.jpg]',
    '       11:06  Karpuz: Şu suyun rengine bak',
    '',
  ])
})

test('joined and left notices, deleted messages, stickers and a left-out sender are absent', () => {
  const result = trial('weekend', '--details')

  for (const absent of ['şifrelidir', 'oluşturdu', 'sizi ekledi', 'katıldı', 'ayrıldı', 'silindi', 'STICKER', 'Çilek', 'Ben de çektim', '00000010']) {
    expect(result.out).not.toContain(absent)
  }
})

test('a photo that is missing from the export is reported and the run goes on', () => {
  const result = trial('missing-media')

  expect(result.status).toBe(0)
  expect(result.out).toContain('Photos:      1')
  expect(result.out).toContain('Problems:    1')
  expect(result.out).toContain('  - Photo missing from the export: 00000004-PHOTO-2023-08-02-18-02-00.jpg (Limon, 2023-08-02 18:02)')
  // The left-out sender's missing photo is not reported, and no raw sender name is printed.
  expect(result.out).not.toContain('Çilek')
  expect(result.out).not.toContain('00000007')
  expect(result.out).not.toContain('Limon L')
  expect(result.out).toContain('1 photo, 4 messages')
})

test('a sender who is not in the people file stops the run and all of them are listed', () => {
  const result = trial('strangers')

  expect(result.status).toBe(1)
  expect(result.out).toBe('')
  expect(result.err).toContain('Not in the people file: İncir İ, Nar N')
})

test('the grouping numbers can be changed on the command line', () => {
  expect(trial('weekend', '--photo-gap', '5').out).toContain('Memories:    3')
  expect(trial('weekend', '--before', '0', '--after', '0').out).toContain('2 photos, 1 message')
  expect(trial('weekend', '--max-messages', '1').out).toContain('2 photos, 3 messages')
})

test('wide windows never take messages of the next memory', () => {
  const result = trial('weekend', '--before', '1000', '--after', '1000', '--max-messages', '100')

  // All ten messages of the chat are kept, each in one memory only.
  expect(result.out).toContain('2 photos, 4 messages')
  expect(result.out).toContain('1 photo, 6 messages')
})

test('a grouping number that is not a number stops the import', () => {
  const result = trial('weekend', '--photo-gap', 'soon')

  expect(result.status).toBe(1)
  expect(result.err).toContain('--photo-gap must be a whole number of minutes')
})

test('a folder with no chat text stops the import', () => {
  const result = ezeliImport(`${fixtures}/no-such-folder`, '--people', people, '--timezone', 'Europe/Istanbul', '--trial')

  expect(result.status).toBe(1)
  expect(result.err).toContain('No _chat.txt in')
})

test('an impossible date or time stops the run and names the line', () => {
  const monthFirst = trial('bad-date-month-first')
  expect(monthFirst.status).toBe(1)
  expect(monthFirst.out).toBe('')
  expect(monthFirst.err).toContain('Line 1: 07/14/2023, 10:00:00 is not a day-first date and time.')

  const february = trial('bad-date-feb31')
  expect(february.status).toBe(1)
  expect(february.err).toContain('Line 2: 31.02.2023, 10:00:00 is not a day-first date and time.')

  const clock = trial('bad-time')
  expect(clock.status).toBe(1)
  expect(clock.err).toContain('Line 2: 05.03.2023, 25:61:00 is not a day-first date and time.')
})

test('messages are put in time order, so a line out of order does not make a small gap', () => {
  const result = trial('out-of-order')

  expect(result.out).toContain('Memories:    2')
})

test('a people file with a value of the wrong type or an unknown key stops the run', () => {
  const run = (file: string) =>
    ezeliImport(`${fixtures}/weekend`, '--people', `${fixtures}/${file}`, '--timezone', 'Europe/Istanbul', '--trial')

  const asText = run('people-left-out-string.json')
  expect(asText.status).toBe(1)
  expect(asText.out).toBe('')
  expect(asText.err).toContain('"leftOut" of Limon must be true or false, without quotes.')

  const typo = run('people-typo.json')
  expect(typo.status).toBe(1)
  expect(typo.err).toContain('Limon in the people file has an unknown key "whatsap". Allowed: id, name, whatsapp, discord, leftOut.')
})

test('every person in the people file needs a fixed id: a lowercase word, used once', () => {
  const run = (file: string) =>
    ezeliImport(`${fixtures}/weekend`, '--people', `${fixtures}/${file}`, '--timezone', 'Europe/Istanbul', '--trial')

  for (const file of ['people-no-id.json', 'people-id-bad.json']) {
    const result = run(file)
    expect(result.status).toBe(1)
    expect(result.err).toContain('Karpuz in the people file needs an "id"')
  }
  const twice = run('people-id-twice.json')
  expect(twice.status).toBe(1)
  expect(twice.err).toContain('The people file has the id "kisi" twice.')
})

test('media files that no message mentions are reported, so an unread layout does not pass quietly', () => {
  const result = trial('unread-media')

  expect(result.status).toBe(0)
  expect(result.out).toContain('Memories:    0')
  expect(result.out).toContain('1 media file in the export is not mentioned in the chat: 00000001-PHOTO-2023-03-05-10-00-00.jpg')
  expect(result.out).toContain('no photo was read')
})

test('the marker for an edited message is removed from the text', () => {
  const result = trial('edited', '--details')

  expect(result.out).toContain('Karpuz: düzeltilmiş mesaj\n')
  expect(result.out).toContain('Limon: bu da öyle\n')
  expect(result.out).not.toContain('edited')
  expect(result.out).not.toContain('düzenlendi')
})

test('a gap of exactly the set time starts a new memory, one second less does not', () => {
  const result = trial('gaps')

  expect(result.out).toContain('Memories:    2')
  expect(result.out).toContain('2 photos, 0 messages  Karpuz, Limon')
  expect(result.out).toContain('1 photo, 0 messages  Fıstık')
})

test('a memory takes at most 30 messages on each side', () => {
  const result = trial('chatty')

  expect(result.out).toContain('1 photo, 60 messages')
})

test('two memories close together keep their own messages', () => {
  const result = trial('close', '--details')
  const lines = result.out.split('\n')
  const second = lines.findIndex((line) => line.startsWith('  2.'))

  expect(lines.slice(0, second).join('\n')).toContain('ilk anıya ait')
  expect(lines.slice(0, second).join('\n')).not.toContain('ikinciye ait')
  expect(lines.slice(second).join('\n')).toContain('ikinciye ait')
})

test('a photo in the "(file attached)" form and an "image omitted" line are read, a deleted notice is skipped', () => {
  const result = trial('other-forms', '--details')

  expect(result.out).toContain('Photos:      1')
  expect(result.out).toContain('Problems:    1')
  expect(result.out).toContain('  - Photo missing from the export: no file in the export (Limon, 2023-03-05 10:01)')
  expect(result.out).toContain('[Photo missing from the export]')
  expect(result.out).not.toContain('deleted')
  expect(result.out).toContain('Fıstık: tamam')
})
