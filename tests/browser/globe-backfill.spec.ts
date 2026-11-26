import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { addPerson, apiUrl, fruit, ownerCommand, secretKey } from './support.ts'

test.use({ locale: 'en-US' })

test('a reimport adds one pin and keeps a hidden photo and memory off the globe', async ({ page }) => {
  const folder = mkdtempSync(join(tmpdir(), 'ezeli-globe-backfill-'))
  const exportPath = join(folder, 'weekend')
  const peoplePath = join(folder, 'people.json')
  const chatName = fruit('Island album')
  const suffix = chatName.split(' ').at(-1)!
  const people = [
    { id: `lemon-${suffix}`, name: `Lemon ${suffix}`, whatsapp: ['Limon L', 'Limon 🌻'] },
    { id: `melon-${suffix}`, name: `Melon ${suffix}`, whatsapp: ['Karpuz K'] },
    { id: `plum-${suffix}`, name: `Plum ${suffix}`, whatsapp: ['Fıstık F'] },
    { id: `berry-${suffix}`, name: `Berry ${suffix}`, whatsapp: ['Çilek Ç'], leftOut: true },
  ]
  const importAgain = () => {
    const run = ownerCommand(['import', exportPath, '--people', peoplePath, '--timezone', 'Europe/Istanbul', '--chat', chatName])
    expect(run.status, run.stderr).toBe(0)
  }
  const hide = (key: string, code?: string) => {
    const run = ownerCommand(['hide', key, ...(code ? [code] : []), '--yes'])
    expect(run.status, run.stderr).toBe(0)
  }

  try {
    cpSync('tests/fixtures/whatsapp-iphone/weekend', exportPath, { recursive: true })
    writeFileSync(peoplePath, JSON.stringify({ people }))
    const photos = [
      '00000007-PHOTO-2023-07-14-20-58-11.jpg',
      '00000009-PHOTO-2023-07-14-21-10-05.jpg',
      '00000020-PHOTO-2023-07-15-11-05-00.jpg',
    ]
    const draft = (index: number) => sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 80 + index * 50, g: 120, b: 85 } } })
    for (const [index, name] of photos.entries()) await draft(index).jpeg().toFile(join(exportPath, name))
    importAgain()

    // Find the two addresses for the owner commands. The friend uses the globe and photo buttons.
    const owner = createClient(apiUrl, secretKey, { auth: { persistSession: false } })
    const chat = await owner.from('chats').select('id').eq('name', chatName).single()
    const saved = await owner.from('memories').select('key').eq('chat_id', chat.data!.id).order('at')
    expect(saved.error).toBeNull()
    expect(saved.data).toHaveLength(2)
    const [kept, gone] = saved.data!.map(({ key }) => key)
    const listing = ownerCommand(['memory', kept!])
    expect(listing.status, listing.stderr).toBe(0)
    const hiddenCode = listing.stdout.split('\n').find((line) => line.includes(`${people[1]!.name}: [Photo]`))?.split(/\s+/)[0]
    expect(hiddenCode).toBeTruthy()
    hide(kept!, hiddenCode)
    hide(gone!)

    for (const [index, name] of photos.entries()) await draft(index).withExif({
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: `${35 + index}/1 10/1 0/1`, GPSLongitudeRef: 'E', GPSLongitude: '33/1 21/1 0/1' },
    }).jpeg().toFile(join(exportPath, name))
    importAgain()
    importAgain()

    await page.goto(addPerson(fruit('Fig')))
    const response = page.waitForResponse((item) => item.url().includes('/rest/v1/located_photos'))
    await page.getByRole('link', { name: 'Globe', exact: true }).click()
    const allPins = await (await response).json() as { display_name: string }[]
    const ownPins = allPins.filter((pin) => people.some(({ name }) => name === pin.display_name))
    expect(ownPins).toEqual([expect.objectContaining({
      display_name: people[0]!.name, memory_key: kept, latitude: expect.closeTo(35.16666667, 8), longitude: 33.35,
      thumb_path: expect.stringMatching(/-thumb\.webp$/),
    })])
    await page.getByRole('button', { name: `Photo sent by ${people[0]!.name}`, exact: true }).click()
    await page.getByRole('link', { name: `Open photo sent by ${people[0]!.name}` }).click()
    await expect(page).toHaveURL(new RegExp(`/m/${kept}$`))
    const viewer = page.getByRole('dialog', { name: 'Photo' })
    await expect(viewer.getByRole('img', { name: `Photo sent by ${people[0]!.name}` })).toBeVisible()
    await viewer.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('region', { name: 'Conversation' })).toBeVisible()
    hide(kept!)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
