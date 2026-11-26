import { expect, test } from '@playwright/test'
import { addPerson, expectNoSidewaysScroll, fruit, openWide, ownerCommand } from './support.ts'

test.use({ locale: 'en-US', timezoneId: 'Europe/Amsterdam' })

const photo = '00000004-PHOTO-2016-06-12-20-03-00.jpg'
const otherPhoto = '00000005-PHOTO-2016-06-12-20-04-00.jpg'
const album = 'tests/fixtures/whatsapp-iphone/album'

test('a friend can retry a photo import and open the resulting memory', async ({ page, browser }) => {
  const caption = fruit('Picnic')
  await page.goto(addPerson(fruit('Limon')))
  await page.getByRole('link', { name: 'Import photos' }).click()
  await expect(page).toHaveURL(/\/import$/)
  await expectNoSidewaysScroll(page)

  await page.getByLabel('Choose photos').setInputFiles([album + '/' + photo, album + '/' + otherPhoto])
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
