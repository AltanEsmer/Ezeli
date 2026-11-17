// The timeline as a friend sees it. The memories were saved by the real import of the made-up
// exports (import.setup.ts): 15 July and 14 July 2023 from one chat, 5 March 2023 from another, and
// 1 December 2022 from a third.
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

    await expect(memories(page)).toHaveCount(4)
    await expect(memories(page).getByRole('heading')).toHaveText(['Saturday, July 15, 2023', 'Friday, July 14, 2023', 'Sunday, March 5, 2023', 'Thursday, December 1, 2022'])
    await expect(memories(page).locator('.by')).toHaveText([
      'Sent by Fıstık',
      'Sent by Limon and Karpuz',
      'Sent by Karpuz, Limon, and Fıstık',
      'Sent by Karpuz',
    ])
    // One photo, two, three: the main photos are stacked behind the first.
    await expect(memories(page).nth(0).locator('img')).toHaveCount(1)
    await expect(memories(page).nth(1).locator('img')).toHaveCount(2)
    await expect(memories(page).nth(2).locator('img')).toHaveCount(3)
  })

  test('sees the photos, which load from short-lived links to a private bucket', async ({ page }) => {
    await openTimeline(page)

    const pictures = memories(page).locator('img')
    await expect(pictures).toHaveCount(7)
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

    await expect(memories(page).getByRole('heading')).toHaveText(['Saturday, July 15, 2023', 'Friday, July 14, 2023', 'Sunday, March 5, 2023', 'Thursday, December 1, 2022'])
    await context.close()
  })

  test.describe('with the browser set to Turkish', () => {
    test.use({ locale: 'tr-TR' })

    test('reads dates and the sender line in Turkish, and the names as they are', async ({ page }) => {
      await openTimeline(page)

      await expect(memories(page).getByRole('heading')).toHaveText(['15 Temmuz 2023 Cumartesi', '14 Temmuz 2023 Cuma', '5 Mart 2023 Pazar', '1 Aralık 2022 Perşembe'])
      await expect(memories(page).locator('.by')).toHaveText([
        'Fıstık gönderdi',
        'Limon ve Karpuz gönderdi',
        'Karpuz, Limon ve Fıstık gönderdi',
        'Karpuz gönderdi',
      ])
    })
  })
})

const heights = (page: Page) => memories(page).locator('.mprint.front').evaluateAll((prints) => prints.map((print) => Math.round(print.getBoundingClientRect().height)))
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Jump to a year or month' })

test.describe('the full timeline', () => {
  test('groups the memories under month and year headings', async ({ page }) => {
    await openTimeline(page)

    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['July 2023', 'March 2023', 'December 2022'])
    await expect(page.locator('section[data-month="2023-07"]').getByRole('article')).toHaveCount(2)
    await expect(page.locator('section[data-month="2023-03"]').getByRole('article')).toHaveCount(1)
  })

  test('shows one line of the conversation as it was written, and the photo and comment counts', async ({ page }) => {
    await openTimeline(page)
    const [fifteenth, fourteenth, march, december] = await memories(page).all()

    // The first text message at or after the first photo...
    await expect(fifteenth!.locator('.line')).toHaveText('“Şu suyun rengine bak”')
    await expect(fourteenth!.locator('.line')).toHaveText('“Çok güzel çıkmış! Işık şahane”')
    // ...no line when the memory has no text message...
    await expect(march!.locator('.line')).toHaveCount(0)
    // ...and the last one before the photo when none comes after it, cut at a word when long.
    const full = 'Akşam yemeği için sofrayı kurduk, herkes geldi, çorba çıktı, ardından balık geldi ve tatlıya kadar kimse kalkmadı çünkü sohbet çok güzeldi 🍉🍉🍉 ve bir de çay içtik'
    const shown = (await december!.locator('.line').innerText()).slice(1, -1)
    expect(shown.endsWith('…')).toBe(true)
    expect(shown).not.toContain('en eski')
    expect(full.startsWith(shown.slice(0, -1))).toBe(true)
    expect(shown.slice(0, -1)).not.toMatch(/\s$|[,.]$/)
    expect(shown.length).toBeLessThan(full.length / 1.5)

    await expect(memories(page).locator('.counts span')).toHaveText([
      '1 photo', 'No comments',
      '2 photos', 'No comments',
      '3 photos', 'No comments',
      '1 photo', 'No comments',
    ])
  })

  test('jumps to a month, or to a year, with the tabs on the right edge', async ({ page }) => {
    await openTimeline(page)

    // The open tab is the year on screen; its months show under it.
    await expect(tabs(page).getByRole('button', { name: '2023', exact: true })).toHaveAttribute('aria-current', 'true')
    await expect(tabs(page).getByRole('button', { name: 'March 2023' })).toBeVisible()
    await expect(tabs(page).getByRole('button', { name: 'December 2022' })).toHaveCount(0)

    const march = page.getByRole('heading', { name: 'March 2023' })
    await tabs(page).getByRole('button', { name: 'March 2023' }).click()
    await expect.poll(async () => (await march.boundingBox())!.y).toBeLessThan(60)
    await expect(tabs(page).getByRole('button', { name: 'March 2023' })).toHaveAttribute('aria-current', 'true')

    await tabs(page).getByRole('button', { name: '2022', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'December 2022' })).toBeInViewport()
    await expect(tabs(page).getByRole('button', { name: '2022', exact: true })).toHaveAttribute('aria-current', 'true')
    await expect(tabs(page).getByRole('button', { name: 'December 2022' })).toBeVisible()
  })

  test('a photo holds its place at its real shape while it loads and when it fails', async ({ browser, page }) => {
    await openTimeline(page)
    await expect(memories(page).locator('img').first()).toHaveJSProperty('complete', true)
    const loaded = await heights(page)

    // Loading: the photo files are held back.
    const phone = { viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() }
    const slow = await browser.newContext(phone)
    const holding = await slow.newPage()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    await holding.route('**/storage/v1/object/sign/photos/**', async (route) => {
      await gate
      await route.continue()
    })
    await holding.goto(page.url())
    await expect(memories(holding)).toHaveCount(4)
    expect(await heights(holding)).toEqual(loaded)
    release()
    await expect(memories(holding).locator('img').first()).toHaveJSProperty('complete', true)
    expect(await heights(holding)).toEqual(loaded)
    await slow.close()

    // Failed: the files cannot be fetched.
    const broken = await browser.newContext(phone)
    const failing = await broken.newPage()
    await failing.route('**/storage/v1/object/sign/photos/**', (route) => route.abort())
    await failing.goto(page.url())
    await expect(failing.getByText('Photo did not load')).toHaveCount(4)
    expect(await heights(failing)).toEqual(loaded)
    await broken.close()
  })

  test.describe('with the browser set to Turkish', () => {
    test.use({ locale: 'tr-TR' })

    test('reads the headings, the tabs and the counts in Turkish, and the conversation line as written', async ({ page }) => {
      await openTimeline(page)

      await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Temmuz 2023', 'Mart 2023', 'Aralık 2022'])
      await expect(page.getByRole('navigation', { name: 'Bir yıla ya da aya git' }).getByRole('button', { name: 'Mart 2023' })).toBeVisible()
      await expect(memories(page).locator('.counts span').first()).toHaveText('1 fotoğraf')
      await expect(memories(page).locator('.counts span').nth(1)).toHaveText('Yorum yok')
      await expect(memories(page).first().locator('.line')).toHaveText('“Şu suyun rengine bak”')
    })
  })
})
