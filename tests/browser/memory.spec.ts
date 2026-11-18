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
  // Gezi Notları: 2 September 2023 and 10 January 2023 (passes midnight). İkiz A and B: one photo
  // each at the very same moment, 1 February 2023 10:00.
  for (const [folder, chat] of [['links', CHAT], ['twin', 'İkiz A'], ['twin', 'İkiz B']] as const) {
    const result = ownerCommand(['import', `${fixtures}/${folder}`, '--people', `${fixtures}/people.json`, '--timezone', 'Europe/Istanbul', '--chat', chat, '--date-order', 'day-first'])
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  }
  // An Android export (3 August 2019) with one line of media that is not in the export.
  const android = ownerCommand(['import', 'tests/fixtures/whatsapp-variants/android-english', '--people', 'tests/fixtures/whatsapp-variants/people.json', '--timezone', 'Europe/Istanbul', '--chat', 'Android Kamp'])
  expect(android.stderr).toBe('')
  expect(android.status).toBe(0)
})

// The access token the app keeps on this device.
const accessToken = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.endsWith('-auth-token'))!
    return JSON.parse(localStorage.getItem(key)!).access_token as string
  })

const heading = (page: Page) => page.getByRole('heading', { level: 1 })

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
  test('reads Android\'s "media omitted" as a line saying the media is not in the export', async ({ page }) => {
    await signIn(page)
    await articles(page).filter({ hasText: 'August 3, 2019' }).getByRole('link').click()

    const talk = page.getByRole('region', { name: 'Conversation' })
    await expect(talk.getByText('Media (not in the export)', { exact: true })).toBeVisible()
    await expect(talk.getByText('Document', { exact: true })).toBeVisible()
  })

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
    await expect(talk.locator('.who')).toHaveText(['Limon', 'Karpuz', 'Fıstık', 'Limon', 'Karpuz', 'Fıstık'])
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

    // The words of the messages; the names above them are links to the people.
    const links = page.getByRole('region', { name: 'Conversation' }).locator('.body').getByRole('link')
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

    // The strip has stopped sliding back, then a real swipe with a finger, from right to left: the next photo.
    await expect.poll(() => viewer.locator('.strip').evaluate((box) => box.scrollLeft)).toBe(0)
    const cdp = await page.context().newCDPSession(page)
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: 400 }] })
    await touch('touchStart', 330)
    for (let x = 300; x >= 60; x -= 30) {
      await touch('touchMove', x)
      await page.waitForTimeout(16)
    }
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

  test('shows every photo whole on the full-screen view, tall or wide, upright or sideways', async ({ page }) => {
    await openNewest(page)

    await page.locator('.prints img').first().click()
    const viewer = page.getByRole('dialog', { name: 'Photo' })
    const whole = async (index: number) => {
      const view = page.viewportSize()!
      const image = viewer.locator('.slide img').nth(index)
      await expect(image).toHaveJSProperty('complete', true)
      // The strip may still be sliding to this photo.
      await expect.poll(async () => Math.abs((await image.boundingBox())!.x)).toBeLessThan(2)
      const box = (await image.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(-1)
      expect(box.y).toBeGreaterThanOrEqual(-1)
      expect(box.x + box.width).toBeLessThanOrEqual(view.width + 1)
      expect(box.y + box.height).toBeLessThanOrEqual(view.height + 1)
    }
    // Photo 1 is a tall 9:16 portrait, photo 2 a wide 16:9 landscape.
    await whole(0)
    await viewer.getByRole('button', { name: 'Next photo' }).click()
    await expect(viewer.getByText('2 / 2')).toBeVisible()
    await whole(1)

    await page.setViewportSize({ width: 844, height: 390 })
    await whole(1)
    await viewer.getByRole('button', { name: 'Previous photo' }).click()
    await expect(viewer.getByText('1 / 2')).toBeVisible()
    await whole(0)
  })

  test('closes the full-screen view with the phone\'s Back and stays on the memory', async ({ page }) => {
    await openNewest(page)
    const memoryAddress = page.url()

    await page.locator('.prints img').first().click()
    const viewer = page.getByRole('dialog', { name: 'Photo' })
    await expect(viewer).toBeVisible()
    await page.goBack()
    await expect(viewer).toHaveCount(0)
    await expect(page).toHaveURL(memoryAddress)
    await expect(heading(page)).toHaveText('Saturday, September 2, 2023')

    // Closing with the button leaves no extra step behind: one Back leads to the timeline.
    await page.locator('.prints img').first().click()
    await viewer.getByRole('button', { name: 'Close' }).click()
    await expect(viewer).toHaveCount(0)
    await page.goBack()
    await expect(articles(page).first()).toBeVisible()
  })

  test('asks for fresh links once when a photo\'s link has run out, then shows the photo', async ({ page }) => {
    const signed: string[] = []
    page.on('request', (request) => request.method() === 'POST' && request.url().endsWith('/object/sign/photos') && signed.push(request.url()))
    // The first request of every large photo fails, as an expired link would.
    const tried = new Set<string>()
    await page.route(/\/object\/sign\/photos\/.+-view\.webp\?token=/, (route) => {
      const path = new URL(route.request().url()).pathname
      if (tried.has(path)) return route.continue()
      tried.add(path)
      return route.abort()
    })
    await openNewest(page)
    const photos = page.locator('.prints img')
    await expect(photos).toHaveCount(2)
    for (const photo of await photos.all()) {
      await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0)
    }
    expect(tried.size).toBe(2)
    // The timeline's links, the memory's links, and one request for fresh ones (not one per photo).
    expect(signed.length).toBe(3)
  })

  test('shows a paper placeholder in the photo\'s shape when the fresh link fails too', async ({ page }) => {
    await page.route(/\/object\/sign\/photos\/.+-view\.webp\?token=/, (route) => route.abort())
    await openNewest(page)

    const gone = page.locator('.prints .gone')
    await expect(gone).toHaveCount(2)
    await expect(page.locator('.prints img')).toHaveCount(0)
    const tall = (await gone.nth(0).boundingBox())!
    const wide = (await gone.nth(1).boundingBox())!
    expect(tall.height).toBeGreaterThan(tall.width)
    expect(wide.width).toBeGreaterThan(wide.height)
  })

  test('puts a day line where the conversation passes midnight', async ({ page }) => {
    await signIn(page)
    // 10 January 2023: the photo at 23:50, a message at 00:10 the next day.
    await articles(page).filter({ hasText: 'January 10, 2023' }).getByRole('link').click()
    await expect(heading(page)).toHaveText('Tuesday, January 10, 2023')
    const talk = page.getByRole('region', { name: 'Conversation' })
    await expect(talk.getByText('Wednesday, January 11, 2023')).toBeVisible()
    await expect(talk.locator('.day')).toHaveCount(1)
    await expect(talk.getByText('00:10', { exact: true })).toBeVisible()
  })

  test('sets the direction of each message by its own letters', async ({ page }) => {
    await openNewest(page)

    await expect(page.getByText('مرحبا يا أصدقاء')).toHaveAttribute('dir', 'auto')
  })

  test('reaches both of two memories from the same moment with earlier and later', async ({ page }) => {
    await signIn(page)
    // Newest first: 2 Sep, 15 Jul, 14 Jul, 5 Mar, then two memories of 1 Feb 10:00, 22 Jan (Discord), 10 Jan, then 3 Aug 2019 (Android).
    await articles(page).nth(3).getByRole('link').click()
    await expect(heading(page)).toHaveText('Sunday, March 5, 2023')
    const earlier = page.getByRole('link', { name: 'Earlier memory' })
    const later = page.getByRole('link', { name: 'Later memory' })

    await earlier.click()
    await expect(heading(page)).toHaveText('Wednesday, February 1, 2023')
    const first = page.url()
    await earlier.click()
    await expect(heading(page)).toHaveText('Wednesday, February 1, 2023')
    const second = page.url()
    expect(second).not.toBe(first)
    await earlier.click()
    await expect(heading(page)).toHaveText('Sunday, January 22, 2023')
    await earlier.click()
    await expect(heading(page)).toHaveText('Tuesday, January 10, 2023')
    // The Android chat (3 August 2019) is the oldest.
    await earlier.click()
    await expect(heading(page)).toHaveText('Saturday, August 3, 2019')
    await expect(earlier).toHaveCount(0)
    await later.click()
    await expect(heading(page)).toHaveText('Tuesday, January 10, 2023')

    await later.click()
    await later.click()
    await expect(page).toHaveURL(second)
    await later.click()
    await expect(page).toHaveURL(first)
    await later.click()
    await expect(heading(page)).toHaveText('Sunday, March 5, 2023')
  })

  test('shows the timeline at its own address for a path the app does not know', async ({ page }) => {
    await signIn(page)
    await page.goto('/people/xyz')
    await expect(articles(page).first()).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
  })

  test('is shown the private page, not "not here", when the link was replaced while a memory is open', async ({ page }) => {
    const name = fruit('Karpuz')
    await page.goto(addPerson(name))
    await expect(articles(page).first()).toBeVisible()
    await articles(page).first().getByRole('link').click()
    await expect(page.getByRole('link', { name: 'Earlier memory' })).toBeVisible()
    const oldToken = await accessToken(page)

    expect(ownerCommand(['person', 'relink', '--name', name]).status).toBe(0)

    // The old token is still one the auth server would accept for a while, yet the function gives it nothing.
    const key = page.url().split('/m/')[1]!
    const read = await page.request.post(`${apiUrl}/rest/v1/rpc/memory_detail`, { headers: { apikey: publishableKey, authorization: `Bearer ${oldToken}` }, data: { p_key: key } })
    expect(read.status()).toBe(200)
    expect(await read.json()).toBeNull()

    await page.getByRole('link', { name: 'Earlier memory' }).click()
    await expect(page.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()
    await expect(page.getByText('This memory is not here')).toHaveCount(0)
    await expect(page.getByText('Open your personal link first. After that, this address will work.')).toBeVisible()
  })

  test('gets each sender\'s lasting person id with the display name, in the one request', async ({ page }) => {
    await openNewest(page)
    const key = page.url().split('/m/')[1]!
    const read = await page.request.post(`${apiUrl}/rest/v1/rpc/memory_detail`, {
      headers: { apikey: publishableKey, authorization: `Bearer ${await accessToken(page)}` },
      data: { p_key: key },
    })
    const memory = await read.json()
    expect(memory.messages.map((m: { by: string; by_id: string }) => `${m.by}:${m.by_id}`)).toEqual(
      expect.arrayContaining(['Limon:limon', 'Karpuz:karpuz', 'Fıstık:fistik']),
    )
    expect(memory.photos.every((p: { by_id: string }) => typeof p.by_id === 'string')).toBe(true)
  })

  test.describe('with the browser set to Turkish', () => {
    test.use({ locale: 'tr-TR' })

    test('reads the media that is not in the export in Turkish', async ({ page }) => {
      await signIn(page)
      await articles(page).filter({ hasText: '3 Ağustos 2019' }).getByRole('link').click()

      await expect(page.getByRole('region', { name: 'Konuşma' }).getByText('Medya (dışa aktarımda yok)', { exact: true })).toBeVisible()
    })

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
    await expect(page.getByText('Open your personal link first. After that, this address will work.')).toBeVisible()
    await expect(page).toHaveTitle('Ezeli')
    await expect(page.locator('body')).not.toContainText(CHAT)
    await expect(page.locator('body')).not.toContainText('Rota burada')
    expect(asked.filter((url) => url.includes('memory_detail') || url.includes('/storage/'))).toEqual([])

    // The database gives a visitor nothing either: the same answer as for a memory that is not there.
    const key = memoryAddress.split('/m/')[1]!
    for (const probe of [key, '0'.repeat(32)]) {
      const read = await page.request.post(`${apiUrl}/rest/v1/rpc/memory_detail`, { headers: { apikey: publishableKey }, data: { p_key: probe } })
      expect(read.status()).toBe(401)
      expect(await read.json()).toMatchObject({ code: '42501', message: 'permission denied for function memory_detail' })
    }

    // After signing in with the personal link on this device, the address opens the memory.
    await page.goto(link)
    await expect(articles(page).first()).toBeVisible()
    await page.goto(memoryAddress)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saturday, September 2, 2023')
    await friend.close()
  })
})

test.describe("a visitor without a session, with the browser set to Turkish", () => {
  test.use({ locale: "tr-TR" })

  test("is told in Turkish to open their personal link first", async ({ page }) => {
    await page.goto(`/m/${"0".repeat(32)}`)
    await expect(page.getByText("Önce kişisel bağlantını aç. Ondan sonra bu adres çalışacak.")).toBeVisible()
  })
})
