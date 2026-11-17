import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'

const fixtures = 'tests/fixtures/whatsapp-iphone'
const people = `${fixtures}/people.json`

function ezeliImport(...args: string[]) {
  const result = spawnSync('node', ['cli/ezeli.ts', 'import', ...args], { encoding: 'utf8' })
  return { status: result.status, out: result.stdout, err: result.stderr }
}

function trial(folder: string, ...options: string[]) {
  return ezeliImport(`${fixtures}/${folder}`, '--people', people, '--timezone', 'Europe/Istanbul', '--trial', ...options)
}

test('a trial run prints the memories, photos, people, date range and problems', () => {
  const result = trial('weekend')

  expect(result.err).toBe('')
  expect(result.status).toBe(0)
  expect(result.out).toBe(
    [
      'Trial run. Nothing was saved.',
      '',
      'Memories:    2',
      'Photos:      3',
      'People:      3 (Çağrı, Deniz, Elif)',
      'Date range:  2023-07-14 to 2023-07-15',
      'Problems:    none',
      '',
      '  1. 2023-07-14 20:58  2 photos, 7 messages  Çağrı, Deniz, Elif',
      '  2. 2023-07-15 11:05  1 photo, 1 message  Çağrı, Deniz',
      '',
    ].join('\n'),
  )
})

test('an import that is missing the folder, people file or time zone shows how to run it', () => {
  const usage = 'Usage: pnpm ezeli import <export folder> --people <file> --timezone <zone> --trial'

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
  expect(twice.err).toContain('The people file lists the WhatsApp sender "Elif Kara" twice.')
})

test('without --trial the import says saving is not built yet and fails', () => {
  const result = ezeliImport(`${fixtures}/weekend`, '--people', people, '--timezone', 'Europe/Istanbul')

  expect(result.status).toBe(1)
  expect(result.err).toContain('Saving is not built yet (issue 11). Add --trial to see what would be imported.')
  expect(result.out).toBe('')
})

test('what the conversation of a memory holds, read from the made-up export', () => {
  const result = trial('weekend', '--details')

  expect(result.status).toBe(0)
  const conversation = result.out.split('\n').slice(8)
  expect(conversation).toEqual([
    '  1. 2023-07-14 20:58  2 photos, 7 messages  Çağrı, Deniz, Elif',
    '       20:47  Çağrı: Ben geldim bile 😎',
    '       20:50  Deniz: İskeleye gelin',
    '                     gün batımı çok güzel',
    '',
    '                     şarj aletini unutmayın',
    '       20:58  Elif: [Photo: 00000007-PHOTO-2023-07-14-20-58-11.jpg]',
    '       20:59  Çağrı: Çok güzel çıkmış! Işık şahane',
    '       21:10  Deniz: [Photo: 00000009-PHOTO-2023-07-14-21-10-05.jpg]',
    '       21:15  Çağrı: [Video]',
    '       21:20  Deniz: [Voice message]',
    '       21:22  Çağrı: [Document]',
    '       21:25  Elif: Yarın tekneye gidiyoruz, unutmayın',
    '',
    '  2. 2023-07-15 11:05  1 photo, 1 message  Çağrı, Deniz',
    '       11:05  Çağrı: [Photo: 00000020-PHOTO-2023-07-15-11-05-00.jpg]',
    '       11:06  Deniz: Şu suyun rengine bak',
    '',
  ])
})

test('joined and left notices, deleted messages, stickers and a left-out sender are absent', () => {
  const result = trial('weekend', '--details')

  for (const absent of ['şifrelidir', 'oluşturdu', 'sizi ekledi', 'katıldı', 'ayrıldı', 'silindi', 'STICKER', 'Tolga', 'Ben de çektim', '00000010']) {
    expect(result.out).not.toContain(absent)
  }
})

test('a photo that is missing from the export is reported and the run goes on', () => {
  const result = trial('missing-media')

  expect(result.status).toBe(0)
  expect(result.out).toContain('Photos:      1')
  expect(result.out).toContain('Problems:    1')
  expect(result.out).toContain('  - Photo missing from the export: 00000004-PHOTO-2023-08-02-18-02-00.jpg (Elif Kara, 2023-08-02 18:02)')
  expect(result.out).toContain('1 photo, 4 messages')
})

test('a sender who is not in the people file stops the run and all of them are listed', () => {
  const result = trial('strangers')

  expect(result.status).toBe(1)
  expect(result.out).toBe('')
  expect(result.err).toContain('Not in the people file: Mert Aksoy, Zeynep Acar')
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

test('a folder that is not an iPhone export stops the import', () => {
  const result = ezeliImport(`${fixtures}/no-such-folder`, '--people', people, '--timezone', 'Europe/Istanbul', '--trial')

  expect(result.status).toBe(1)
  expect(result.err).toContain('No _chat.txt in')
})
