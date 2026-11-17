// One memory as a friend sees it. The data is what the real import saved (import.setup.ts: the
// Kaş Tatili and Mart Gezisi chats) plus one more chat imported here, whose memory is the newest:
// 2 September 2023, two photos, links, a video, a voice message and a document.
import { type Page, expect, test } from '@playwright/test'
import { addPerson, apiUrl, fruit, ownerCommand, publishableKey } from './support.ts'

const fixtures = 'tests/fixtures/whatsapp-iphone'
const articles = (page: Page) => page.getByRole('article')
const address = /\/m\/[0-9a-f]{32}$/
const CHAT = 'Gezi Notları'

test.beforeAll(() => {
  const result = ownerCommand(['import', `${fixtures}/links`, '--people', `${fixtures}/people.json`, '--timezone', 'Europe/Istanbul', '--chat', CHAT])
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
})

async function signIn(page: Page) {
  await page.goto(addPerson(fruit('Karpuz')))
  await expect(articles(page).first()).toBeVisible()
}

// Signs in and opens the newest memory (2 September) from the timeline.
async function openNewest(page: Page) {
  await signIn(page)
  await articles(page).first().getByRole('link').click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

test.describe('a friend on a memory', () => {
  test('opens it from the timeline to its own address and sees the date, the chat and all photos large', async ({ page }) => {
    await openNewest(page)

    await expect(page).toHaveURL(address)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saturday, September 2, 2023')
    await expect(page.getByText(CHAT, { exact: true })).toBeVisible()
    const photos = page.locator('.prints img')
    await expect(photos).toHaveCount(2)
    for (const photo of await photos.all()) {
      await expect(photo).toHaveJSProperty('complete', true)
      expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
      expect(await photo.getAttribute('src')).toMatch(/-view\.webp\?token=/)
      expect((await photo.boundingBox())!.width).toBeGreaterThan(280)
    }
  })

  test('reads the conversation by sender, with the time in the chat\'s zone wherever the reader is', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'Pacific/Kiritimati' })
    const page = await context.newPage()
    await openNewest(page)

    const talk = page.getByRole('region', { name: 'Conversation' })
    // Messages of one sender in a row sit under one name.
    await expect(talk.locator('.who')).toHaveText(['Limon', 'Karpuz', 'Fıstık', 'Limon', 'Karpuz'])
    await expect(talk.getByText('17:55', { exact: true })).toBeVisible()
    await expect(talk.getByText('18:20', { exact: true })).toBeVisible()
    await expect(talk.getByText('Rota burada')).toBeVisible()
    // Written text stays text, never markup.
    await expect(talk.getByText('Tam <b>burası</b>', { exact: false })).toBeVisible()
    await expect(talk.locator('b')).toHaveCount(0)
    // A video, a voice message and a document are one short line each.
    await expect(talk.getByText('Video', { exact: true })).toBeVisible()
    await expect(talk.getByText('Voice message', { exact: true })).toBeVisible()
    await expect(talk.getByText('Document', { exact: true })).toBeVisible()
    // The photos sent in the chat are shown small where they were sent.
    await expect(talk.locator('img')).toHaveCount(2)
    await context.close()
  })

  test('can tap real web addresses, which open safely in a new tab, and nothing else', async ({ page }) => {
    await openNewest(page)

    const links = page.getByRole('region', { name: 'Conversation' }).getByRole('link')
    await expect(links).toHaveCount(3)
    await expect(links).toHaveText(['https://example.com/rota?gun=2', 'www.example.org/kas', 'https://example.com/yer'])
    expect(await links.evaluateAll((all) => all.map((a) => (a as HTMLAnchorElement).href))).toEqual([
      'https://example.com/rota?gun=2',
      'https://www.example.org/kas',
      'https://example.com/yer',
    ])
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute('target', '_blank')
      expect(await link.getAttribute('rel')).toContain('noopener')
      expect(await link.getAttribute('rel')).toContain('noreferrer')
    }
  })

  test('opens a photo full screen, moves between photos with buttons, keys and a swipe, and closes it', async ({ page }) => {
    await openNewest(page)

    await page.locator('.prints img').first().click()
    const viewer = page.getByRole('dialog', { name: 'Photo' })
    await expect(viewer).toBeVisible()
    await expect(viewer.getByText('1 / 2')).toBeVisible()
    await expect(viewer.getByRole('button', { name: 'Previous photo' })).toBeDisabled()

    await viewer.getByRole('button', { name: 'Next photo' }).click()
    await expect(viewer.getByText('2 / 2')).toBeVisible()
    await expect(viewer.getByRole('button', { name: 'Next photo' })).toBeDisabled()
    await page.keyboard.press('ArrowLeft')
    await expect(viewer.getByText('1 / 2')).toBeVisible()

    // A real swipe with a finger, from right to left: the next photo.
    const cdp = await page.context().newCDPSession(page)
    const touch = (type: string, x: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: 400 }] })
    await touch('touchStart', 330)
    for (let x = 300; x >= 60; x -= 30) await touch('touchMove', x)
    await touch('touchEnd', 60)
    await expect(viewer.getByText('2 / 2')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
    await expect(page).toHaveURL(address)
  })

  test('opens the full-screen view on the photo that was tapped in the conversation', async ({ page }) => {
    await openNewest(page)

    await page.getByRole('region', { name: 'Conversation' }).locator('img').nth(1).click()
    const viewer = page.getByRole('dialog', { name: 'Photo' })
    await expect(viewer.getByText('2 / 2')).toBeVisible()
  })

  test('goes to the memory before and after, and the newest has none after it', async ({ page }) => {
    await openNewest(page)

    await expect(page.getByRole('link', { name: 'Later memory' })).toHaveCount(0)
    await page.getByRole('link', { name: 'Earlier memory' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saturday, July 15, 2023')
    await page.getByRole('link', { name: 'Earlier memory' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friday, July 14, 2023')
    await page.getByRole('link', { name: 'Later memory' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saturday, July 15, 2023')
  })

  test('the address of a memory stays the same and the browser\'s back and forward work', async ({ page }) => {
    await openNewest(page)
    const newest = page.url()

    await page.getByRole('link', { name: 'Earlier memory' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saturday, July 15, 2023')
    expect(page.url()).not.toBe(newest)

    await page.goBack()
    await expect(articles(page).first()).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
    await page.goForward()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page).toHaveURL(address)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('goes back to the same place in the timeline, by the browser\'s back and by the button', async ({ page }) => {
    await signIn(page)
    const last = articles(page).last()
    await last.scrollIntoViewIfNeeded()
    const date = await last.getByRole('heading').textContent()
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
    await last.getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(date!)

    await page.goBack()
    await expect(last).toBeInViewport({ ratio: 0.5 })

    await last.getByRole('link').click()
    await page.getByRole('button', { name: 'All memories' }).click()
    await expect(articles(page).first()).toBeVisible()
    await expect(last).toBeInViewport({ ratio: 0.5 })
  })

  test('opens a pasted address in a new tab of the same device', async ({ page, context }) => {
    await openNewest(page)
    const copy = await context.newPage()
    await copy.goto(page.url())
    await expect(copy.getByRole('heading', { level: 1 })).toHaveText('Saturday, September 2, 2023')
  })

  test('is told the same thing for a memory that does not exist and for one that cannot be read', async ({ page }) => {
    await openNewest(page)
    await page.goto(`/m/${'0'.repeat(32)}`)
    await expect(page.getByRole('heading', { name: 'This memory is not here' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'All memories' })).toBeVisible()
    await expect(page.getByText(CHAT)).toHaveCount(0)
  })

  test.describe('with the browser set to Turkish', () => {
    test.use({ locale: 'tr-TR' })

    test('reads every label in Turkish and the messages as written', async ({ page }) => {
      await openNewest(page)

      await expect(page.getByRole('heading', { level: 1 })).toHaveText('2 Eylül 2023 Cumartesi')
      await expect(page.getByRole('button', { name: 'Tüm anılar' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Önceki anı' })).toBeVisible()
      const talk = page.getByRole('region', { name: 'Konuşma' })
      await expect(talk.getByText('Sesli mesaj', { exact: true })).toBeVisible()
      await expect(talk.getByText('Belge', { exact: true })).toBeVisible()
      await expect(talk.getByText('Gece yarısına az kaldı')).toBeVisible()

      await page.locator('.prints img').first().click()
      const viewer = page.getByRole('dialog', { name: 'Fotoğraf' })
      await expect(viewer.getByRole('button', { name: 'Sonraki fotoğraf' })).toBeVisible()
      await expect(viewer.getByRole('button', { name: 'Kapat' })).toBeVisible()
    })
  })
})

test.describe('a visitor without a session', () => {
  test('is asked to open their personal link first, and gets nothing of the memory', async ({ page, browser }) => {
    // The address of a memory, from a friend's device.
    const friend = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' })
    const mine = await friend.newPage()
    await openNewest(mine)
    const memoryAddress = mine.url()
    const link = addPerson(fruit('Limon'))

    const asked: string[] = []
    page.on('request', (request) => asked.push(request.url()))
    await page.goto(memoryAddress)
    await expect(page.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()
    await expect(page.getByText('personal link', { exact: false })).toBeVisible()
    await expect(page).toHaveTitle('Ezeli')
    await expect(page.locator('body')).not.toContainText(CHAT)
    await expect(page.locator('body')).not.toContainText('Rota burada')
    expect(asked.filter((url) => url.includes('memory_detail') || url.includes('/storage/'))).toEqual([])

    // The database gives a visitor nothing either: the same answer as for a memory that is not there.
    const key = memoryAddress.split('/m/')[1]!
    for (const probe of [key, '0'.repeat(32)]) {
      const read = await page.request.post(`${apiUrl}/rest/v1/rpc/memory_detail`, { headers: { apikey: publishableKey }, data: { p_key: probe } })
      expect(await read.text()).not.toContain(CHAT)
    }

    // After signing in with the personal link on this device, the address opens the memory.
    await page.goto(link)
    await expect(articles(page).first()).toBeVisible()
    await page.goto(memoryAddress)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saturday, September 2, 2023')
    await friend.close()
  })
})
