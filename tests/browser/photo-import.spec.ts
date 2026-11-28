import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { addPerson, expectNoSidewaysScroll, fruit, openWide, ownerCommand } from './support.ts'

test.use({ locale: 'en-US', timezoneId: 'Europe/Amsterdam' })

const photo = '00000004-PHOTO-2016-06-12-20-03-00.jpg'
const otherPhoto = '00000005-PHOTO-2016-06-12-20-04-00.jpg'
const album = 'tests/fixtures/whatsapp-iphone/album'

test('a friend can retry a photo import and open the resulting memory', async ({ page, browser }) => {
  const caption = fruit('Picnic')
  const uploader = fruit('Limon')
  await page.goto(addPerson(uploader))
  await page.getByRole('link', { name: 'Import photos' }).click()
  await expect(page).toHaveURL(/\/import$/)
  await expectNoSidewaysScroll(page)

  const invalidGps = await sharp(album + '/' + otherPhoto).withExif({
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '91/1 0/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '33/1 21/1 0/1' },
  }).jpeg().toBuffer()
  await page.getByLabel('Choose photos').setInputFiles([
    { name: photo, mimeType: 'image/jpeg', buffer: await readFile(album + '/' + photo) },
    { name: otherPhoto, mimeType: 'image/jpeg', buffer: invalidGps },
  ])
  const first = page.getByRole('group', { name: photo, exact: true })
  const remaining = page.getByRole('group', { name: otherPhoto, exact: true })
  await first.getByLabel('Date and time taken').fill('2099-06-12T18:30')
  await first.getByLabel('Place', { exact: true }).fill('Pine Grove')
  await first.getByLabel('Comment', { exact: true }).fill(caption)
  await remaining.getByLabel('Date and time taken').fill('2099-06-12T18:35')
  await remaining.getByLabel('Place', { exact: true }).fill('Pine Trail')
  await remaining.getByLabel('Comment', { exact: true }).fill('Five minutes later')
  await page.route('**/rest/v1/rpc/import_photo', (route) =>
    route.fulfill({ status: 503, json: { message: 'Unavailable' } }), { times: 1 })
  await first.getByRole('button', { name: 'Save photo' }).click()
  await expect(page.getByRole('alert')).toHaveText('Could not save. Try again.')
  await first.getByRole('button', { name: 'Save photo' }).click()
  await page.getByRole('link', { name: photo, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Jun 12, 2099.*6:30 PM/)
  await expect(page.getByText('Pine Grove')).toBeVisible()
  await expect(page.getByText(caption)).toBeVisible()

  const friend = await openWide(browser, addPerson(fruit('Karpuz')))
  try {
    const card = friend.page.getByRole('article').first()
    await expect(card.getByText(/June 12, 2099/)).toBeVisible()
    await card.getByRole('link').first().click()
    await expect(friend.page).toHaveURL(page.url())
    await expect(friend.page.getByText(caption)).toBeVisible()
  } finally {
    await friend.context.close()
  }

  await page.getByRole('button', { name: 'Import photos', exact: true }).click()
  await expect(remaining.getByLabel('Date and time taken')).toHaveValue('2099-06-12T18:35')
  await expect(remaining.getByLabel('Place', { exact: true })).toHaveValue('Pine Trail')
  await expect(remaining.getByLabel('Comment', { exact: true })).toHaveValue('Five minutes later')
  await remaining.getByRole('button', { name: 'Save photo' }).click()
  await page.getByRole('link', { name: otherPhoto, exact: true }).click()
  await expect(page.getByText('Five minutes later')).toBeVisible()
  await expect(page.getByText('Pine Trail')).toBeVisible()
  await page.goto('/globe')
  await expect(page.getByRole('heading', { name: 'Globe' })).toBeVisible()
  await expect(page.getByRole('button', { name: `Photo sent by ${uploader}`, exact: true })).toHaveCount(0)
})

test('the owner can hide one of two photos from the same uploader and minute', async ({ page, request }) => {
  await page.goto(addPerson(fruit('Erik')))
  await page.getByRole('link', { name: 'Import photos' }).click()
  await page.getByLabel('Choose photos').setInputFiles([album + '/' + photo, album + '/' + otherPhoto])
  const addresses = new Map<string, string>()
  for (const name of [photo, otherPhoto]) {
    const draft = page.getByRole('group', { name, exact: true })
    await draft.getByLabel('Date and time taken').fill('2098-06-12T18:30')
    await draft.getByLabel('Comment', { exact: true }).fill(name)
    await draft.getByRole('button', { name: 'Save photo' }).click()
    addresses.set(name, (await page.getByRole('link', { name, exact: true }).getAttribute('href'))!)
  }
  const target = addresses.get(photo)!
  await page.goto(target)
  const held = (await page.getByRole('figure').locator('img').first().getAttribute('src'))!
  expect((await request.get(held)).ok()).toBe(true)

  const listing = ownerCommand(['memory', target])
  expect(listing.status, listing.stderr).toBe(0)
  const code = listing.stdout.match(/^(\S+).*\[Photo\]/m)?.[1]
  expect(code).toMatch(/^[0-9a-f]{8}$/)
  const hidden = ownerCommand(['hide', target, code!])
  expect(hidden.status, hidden.stdout + hidden.stderr).toBe(0)
  expect(hidden.stdout).toContain('Hidden: 1 message (1 photo')
  expect((await request.get(held)).ok()).toBe(false)

  // Reapplying the mark after the photo is gone must still leave its neighbour alone.
  const reapplied = ownerCommand(['hidden'])
  expect(reapplied.status, reapplied.stderr).toBe(0)
  await page.goto(target)
  await expect(page.getByRole('heading', { name: 'This memory is not here' })).toBeVisible()
  await page.goto(addresses.get(otherPhoto)!)
  await expect(page.getByText(otherPhoto, { exact: true })).toBeVisible()
})

test('a standalone photo appears on the globe only after publication and disappears after hiding', async ({ page, browser, request }) => {
  const uploader = fruit('Melon')
  const name = 'harbor.jpg'
  const highlight = fruit('Harbor')
  const original = await sharp(album + '/' + photo).withExif({
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 10/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '33/1 21/1 0/1' },
  }).jpeg().toBuffer()

  await page.goto(addPerson(uploader))
  await page.getByRole('link', { name: 'Import photos' }).click()
  await page.getByLabel('Choose photos').setInputFiles({ name, mimeType: 'image/jpeg', buffer: original })
  const draft = page.getByRole('group', { name, exact: true })
  await draft.getByLabel('Date and time taken').fill('2097-06-12T19:45')
  await draft.getByLabel('Place', { exact: true }).fill('Harbor walk')
  await draft.getByLabel('Comment', { exact: true }).fill(highlight)
  const save = draft.getByRole('button', { name: 'Save photo' })

  const friend = await openWide(browser, addPerson(fruit('Lime')))
  const pin = friend.page.getByRole('button', { name: `Photo sent by ${uploader}`, exact: true })
  let published: string | undefined
  const hidePublished = () => {
    if (!published) return
    const hidden = ownerCommand(['hide', published, '--yes'])
    expect(hidden.status, hidden.stderr).toBe(0)
    published = undefined
  }
  try {
    const publish = '**/rest/v1/rpc/import_photo'
    // The WebPs reached storage, but publication did not. No one else can see a pin.
    await page.route(publish, (route) => route.fulfill({ status: 503, json: { message: 'Unavailable' } }), { times: 1 })
    await save.click()
    await expect(page.getByRole('alert')).toHaveText('Could not save. Try again.')
    await friend.page.getByRole('link', { name: 'Globe', exact: true }).click()
    await expect(friend.page.getByRole('heading', { name: 'Globe' })).toBeVisible()
    await expect(friend.page.getByText('No located photos yet')).toBeVisible()
    await expect(pin).toHaveCount(0)

    // Lose the response this time after the real server commits. Its next retry must stay idempotent.
    await page.route(publish, async (route) => {
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      published = `manual:${route.request().postDataJSON().p_id}`
      await route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    }, { times: 1 })
    await save.click()
    await expect(page.getByRole('alert')).toHaveText('Could not save. Try again.')
    await save.click()
    const address = await page.getByRole('link', { name, exact: true }).getAttribute('href')

    await friend.page.goto('/')
    await expect(friend.page.getByRole('article').filter({ hasText: /June 12, 2097/ })).toHaveCount(1)
    const located = friend.page.waitForResponse((response) => response.url().includes('/rest/v1/located_photos?'))
    await friend.page.getByRole('link', { name: 'Globe', exact: true }).click()
    const photos = await (await located).json()
    expect(photos).toHaveLength(1)
    expect(photos[0]).toMatchObject({ display_name: uploader, longitude: 33.35 })
    expect(photos[0].latitude).toBeCloseTo(35.166667, 6)
    await expect(pin).toHaveCount(1)
    await pin.click()
    const preview = friend.page.getByRole('link', { name: new RegExp(`Open photo sent by ${uploader}$`) })
    const thumbnail = preview.getByRole('img')
    await expect(thumbnail).toHaveAttribute('src', /-thumb[.]webp/)
    const thumbnailUrl = (await thumbnail.getAttribute('src'))!
    await preview.click()
    await expect(friend.page).toHaveURL(new URL(address!, friend.page.url()).href)
    const viewer = friend.page.getByRole('dialog', { name: 'Photo' })
    await expect(viewer.getByText('1 / 1')).toBeVisible()
    const viewingImage = viewer.getByRole('img', { name: `Photo sent by ${uploader}`, exact: true })
    await expect(viewingImage).toHaveAttribute('src', /-view[.]webp/)
    const variantUrls = [(await viewingImage.getAttribute('src'))!, thumbnailUrl]
    for (const url of variantUrls) {
      const asset = await request.get(url)
      expect(asset.ok()).toBe(true)
      const metadata = await sharp(await asset.body()).metadata()
      expect(metadata.format).toBe('webp')
      expect(metadata.exif).toBeUndefined()
      expect(metadata.xmp).toBeUndefined()
    }
    await viewer.getByRole('button', { name: 'Close' }).click()
    await expect(friend.page.getByRole('heading', { level: 1 })).toHaveText(/Jun 12, 2097.*7:45 PM/)
    await expect(friend.page.getByText('Harbor walk')).toBeVisible()
    await expect(friend.page.getByText(highlight, { exact: true })).toHaveCount(1)

    hidePublished()
    await friend.page.getByRole('button', { name: 'Globe', exact: true }).click()
    await expect(friend.page.getByRole('heading', { name: 'Globe' })).toBeVisible()
    await expect(friend.page.getByText('No located photos yet')).toBeVisible()
    await expect(pin).toHaveCount(0)
  } finally {
    try {
      hidePublished()
    } finally {
      await friend.context.close()
    }
  }
})
