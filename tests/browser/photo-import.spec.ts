import { expect, test } from '@playwright/test'
import { addPerson, expectNoSidewaysScroll, fruit, openWide } from './support.ts'

test.use({ locale: 'en-US', timezoneId: 'Europe/Amsterdam' })

test('a friend can retry a photo import and open the resulting memory', async ({ page, browser }) => {
  const caption = fruit('Picnic')
  await page.goto(addPerson(fruit('Limon')))
  await page.getByRole('link', { name: 'Import photos' }).click()
  await expect(page).toHaveURL(/\/import$/)
  await expectNoSidewaysScroll(page)

  await page.getByLabel('Choose photos').setInputFiles(
    'tests/fixtures/whatsapp-iphone/album/00000004-PHOTO-2016-06-12-20-03-00.jpg',
  )
  await page.getByLabel('Date and time taken').fill('2099-06-12T18:30')
  await page.getByLabel('Place', { exact: true }).fill('Pine Grove')
  await page.getByLabel('Comment', { exact: true }).fill(caption)
  await page.route('**/rest/v1/rpc/import_photo', (route) =>
    route.fulfill({ status: 503, json: { message: 'Unavailable' } }), { times: 1 })
  await page.getByRole('button', { name: 'Save photo' }).click()
  await expect(page.getByRole('alert')).toHaveText('Could not save. Try again.')
  await page.getByRole('button', { name: 'Save photo' }).click()
  await page.getByRole('link', { name: '00000004-PHOTO-2016-06-12-20-03-00.jpg' }).click()
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
})
