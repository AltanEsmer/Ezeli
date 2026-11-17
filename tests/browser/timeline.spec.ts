// The timeline as a friend sees it. The memories were saved by the real import of the made-up
// exports (import.setup.ts): 15 July and 14 July 2023 from one chat, 5 March 2023 from another.
import { type Page, expect, test } from '@playwright/test'
import { addPerson, apiUrl, fruit, publishableKey } from './support.ts'

const memories = (page: Page) => page.getByRole('article')

async function openTimeline(page: Page) {
  await page.goto(addPerson(fruit('Karpuz')))
  await expect(memories(page).first()).toBeVisible()
}

test.describe('a visitor without a link', () => {
  test('is shown no memory, and the database and the bucket give them nothing', async ({ page, request }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()
    await expect(memories(page)).toHaveCount(0)

    for (const table of ['timeline', 'chats', 'memories', 'messages', 'photos']) {
      const read = await request.get(`${apiUrl}/rest/v1/${table}?select=*`, { headers: { apikey: publishableKey } })
      expect(await read.json(), table).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: expect.anything() })]))
    }
    const files = await request.post(`${apiUrl}/storage/v1/object/list/photos`, {
      headers: { apikey: publishableKey },
      data: { prefix: '', limit: 10 },
    })
    expect(await files.json()).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: expect.anything() })]))
  })
})

test.describe('a friend on the timeline', () => {
  test('sees the memories newest first, each with its date, its photos and who sent them', async ({ page }) => {
    await openTimeline(page)

    await expect(memories(page)).toHaveCount(3)
    await expect(memories(page).getByRole('heading')).toHaveText(['Saturday, July 15, 2023', 'Friday, July 14, 2023', 'Sunday, March 5, 2023'])
    await expect(memories(page).locator('.by')).toHaveText([
      'Sent by Fıstık',
      'Sent by Limon and Karpuz',
      'Sent by Karpuz, Limon, and Fıstık',
    ])
    // One photo, two, three: the main photos are stacked behind the first.
    await expect(memories(page).nth(0).locator('img')).toHaveCount(1)
    await expect(memories(page).nth(1).locator('img')).toHaveCount(2)
    await expect(memories(page).nth(2).locator('img')).toHaveCount(3)
  })

  test('sees the photos, which load from short-lived links to a private bucket', async ({ page }) => {
    await openTimeline(page)

    const pictures = memories(page).locator('img')
    await expect(pictures).toHaveCount(6)
    for (const picture of await pictures.all()) {
      await expect(picture).toHaveJSProperty('complete', true)
      expect(await picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
      expect(await picture.getAttribute('src')).toMatch(/\/storage\/v1\/object\/sign\/photos\/.+-thumb\.webp\?token=/)
    }
    await expect(memories(page).first().getByRole('img', { name: 'Photo sent by Fıstık' })).toBeVisible()
  })

  test('sees the memory on the day it was sent in the chat, wherever the reader is', async ({ browser }) => {
    // 14 July 17:58 UTC is already the 15th for a reader at UTC+14. The memory stays on the 14th.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'Pacific/Kiritimati' })
    const page = await context.newPage()
    await openTimeline(page)

    await expect(memories(page).getByRole('heading')).toHaveText(['Saturday, July 15, 2023', 'Friday, July 14, 2023', 'Sunday, March 5, 2023'])
    await context.close()
  })

  test.describe('with the browser set to Turkish', () => {
    test.use({ locale: 'tr-TR' })

    test('reads dates and the sender line in Turkish, and the names as they are', async ({ page }) => {
      await openTimeline(page)

      await expect(memories(page).getByRole('heading')).toHaveText(['15 Temmuz 2023 Cumartesi', '14 Temmuz 2023 Cuma', '5 Mart 2023 Pazar'])
      await expect(memories(page).locator('.by')).toHaveText([
        'Fıstık gönderdi',
        'Limon ve Karpuz gönderdi',
        'Karpuz, Limon ve Fıstık gönderdi',
      ])
    })
  })
})
