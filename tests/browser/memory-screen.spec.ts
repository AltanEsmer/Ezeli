// The memory screen as a friend sees it: one photo on the stage with the others as squares, the
// conversation as plain lines, and on a PC the stage staying in place beside the column. The data
// is the album of memory-list.setup.ts (12 June 2016: eight photos), the evening by the sea of
// memory-screen.setup.ts (four photos, 19 messages, past midnight) and the chats of memory.setup.ts.
import { type Page, expect, test } from '@playwright/test'
import { addPerson, expectNoSidewaysScroll, fruit, openWide } from './support.ts'

const talk = (page: Page) => page.getByRole('region', { name: 'Conversation' })
const squares = (page: Page) => page.getByRole('group', { name: 'Photos' }).getByRole('button')
const stage = (page: Page) => page.getByRole('figure')

// Opens the memory that a search for the word finds (the card with that date, when other memories
// have the word too), in a window that is already signed in.
async function openFoundHere(page: Page, word: string, date: RegExp, searchLink = 'Search') {
  await expect(page.getByRole('article').first()).toBeVisible()
  await page.getByRole('link', { name: searchLink, exact: true }).click()
  await page.getByRole('searchbox').fill(word)
  await page.getByRole('searchbox').press('Enter')
  const card = page.getByRole('article').filter({ hasText: date })
  await expect(card).toHaveCount(1)
  await card.getByRole('link').click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}
const openAlbum = (page: Page, link = addPerson(fruit('Karpuz'))) => page.goto(link).then(() => openFoundHere(page, 'hepsi', /June 12, 2016/))
const openEvening = (page: Page, link = addPerson(fruit('Karpuz'))) => page.goto(link).then(() => openFoundHere(page, 'batımı', /July 21, 2018/))
// A memory of one photo (10 January 2023).
const openOne = (page: Page) => page.goto(addPerson(fruit('Karpuz'))).then(() => openFoundHere(page, 'yılbaşından', /January 10, 2023/))

test.describe('on a phone', () => {
  test('shows the first photo on the stage and every photo as a square; a square puts its photo on the stage', async ({ page }) => {
    await openAlbum(page)

    await expect(stage(page).locator('img')).toHaveCount(1)
    await expect(squares(page)).toHaveCount(8)
    await expect(squares(page).first()).toHaveAttribute('aria-pressed', 'true')
    await expect(stage(page).getByText('1 / 8')).toBeVisible()
    await expect(stage(page).getByText('Karpuz', { exact: true })).toBeVisible()
    const first = await stage(page).locator('img').getAttribute('src')

    await squares(page).nth(1).click()
    await expect(stage(page).getByText('2 / 8')).toBeVisible()
    await expect(stage(page).getByText('Limon', { exact: true })).toBeVisible()
    await expect(squares(page).nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(squares(page).first()).toHaveAttribute('aria-pressed', 'false')
    expect(await stage(page).locator('img').getAttribute('src')).not.toBe(first)
  })

  test('a memory with one photo has no squares and no counter', async ({ page }) => {
    await openOne(page)

    await expect(stage(page).locator('img')).toHaveCount(1)
    await expect(page.getByRole('group', { name: 'Photos' })).toHaveCount(0)
    await expect(stage(page).getByText(/ \/ /)).toHaveCount(0)
  })

  test('pressing the stage opens the photo that is on it, full screen', async ({ page }) => {
    await openAlbum(page)
    await squares(page).nth(2).click()

    await stage(page).locator('img').click()
    const viewer = page.getByRole('dialog', { name: 'Photo' })
    await expect(viewer.getByText('3 / 8')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
  })

  test('the column holds the date, the chat, the photo count and who sent the photos, in that order', async ({ page }) => {
    await openAlbum(page)

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sunday, June 12, 2016')
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!
    const chat = (await page.getByText('Yaz Albümü', { exact: true }).boundingBox())!
    const count = (await page.getByText('8 photos', { exact: true }).boundingBox())!
    const by = (await page.getByText(/^Sent by/).boundingBox())!
    expect(heading.y).toBeLessThan(chat.y)
    expect(chat.y).toBeLessThan(count.y)
    expect(count.y).toBeLessThan(by.y)
    await expect(page.getByText(/^Sent by/).getByRole('link')).toHaveText(['Karpuz', 'Limon', 'Fıstık'])
    // The conversation starts under them.
    expect((await talk(page).boundingBox())!.y).toBeGreaterThan(by.y)
  })

  test('the stage comes first, then the squares, then the column', async ({ page }) => {
    await openAlbum(page)

    const back = (await page.getByRole('button', { name: /Search$/ }).boundingBox())!
    const photo = (await stage(page).locator('img').boundingBox())!
    const small = (await squares(page).first().boundingBox())!
    const date = (await page.getByRole('heading', { level: 1 }).boundingBox())!
    expect(back.y).toBeLessThan(photo.y)
    expect(photo.y + photo.height).toBeLessThanOrEqual(small.y)
    expect(small.y + small.height).toBeLessThanOrEqual(date.y)
    // Edge to edge on a phone.
    expect(photo.width).toBe(390)
  })

  test('a short conversation shows everything and no buttons', async ({ page }) => {
    await openAlbum(page)

    await expect(talk(page).getByText('Hepsi burada, albüm hazır')).toBeVisible()
    await expect(talk(page).getByRole('button', { name: /messages$/ })).toHaveCount(0)
  })

  test('shows the sender and the time once for a run of messages, and no bubbles to tap', async ({ page }) => {
    await openAlbum(page, addPerson(fruit('Limon')))

    // Eight photos from three senders in turn, then a line from the last sender: one name for that run.
    await expect(talk(page).getByRole('heading', { level: 4 })).toHaveText(['Karpuz', 'Limon', 'Fıstık', 'Karpuz', 'Limon', 'Fıstık', 'Karpuz', 'Limon'])
    await expect(talk(page).getByText('20:10', { exact: true })).toHaveCount(0)
  })

  test('a photo in the conversation is a small square that opens that photo full screen on a phone', async ({ page }) => {
    await openAlbum(page)

    const small = talk(page).getByRole('button', { name: 'Open photo 4' })
    const box = (await small.boundingBox())!
    expect(box.width).toBe(box.height)
    expect(box.width).toBeLessThan(100)
    await small.click()
    await expect(page.getByRole('dialog', { name: 'Photo' }).getByText('4 / 8')).toBeVisible()
  })

  test('marks the names, the chat and the messages as Turkish, under English labels', async ({ page }) => {
    await openEvening(page)

    await expect(page.getByText('Yaz Gecesi', { exact: true })).toHaveAttribute('lang', 'tr')
    await expect(talk(page).getByText('Masayı ayırttım')).toHaveAttribute('lang', 'tr')
    await expect(talk(page).getByRole('heading', { level: 4 }).first()).toHaveAttribute('lang', 'tr')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('does not scroll sideways', async ({ page }) => {
    await openAlbum(page)
    await expectNoSidewaysScroll(page)
  })

  test('a memory that is not there is a small page with one button back', async ({ page }) => {
    await openAlbum(page)
    await page.goto(`/m/${'0'.repeat(32)}`)

    const notice = page.getByRole('heading', { name: 'This memory is not here' })
    await expect(notice).toBeVisible()
    await expect(page.getByText('The address may be wrong, or the memory is not there any more.')).toBeVisible()
    await expect(page.getByRole('button')).toHaveText('All memories')
    await expectNoSidewaysScroll(page)
  })
})

test.describe('a memory with several photos and a long conversation', () => {
  test('opens on nine messages with the photos in them as squares, and the rest after the buttons, with the day line', async ({ page }) => {
    await openEvening(page)

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saturday, July 21, 2018')
    await expect(squares(page)).toHaveCount(4)
    // Three before the first photo, then to the ninth message: 3 hidden before, 7 after.
    await expect(talk(page).getByText('Masayı ayırttım')).toBeVisible()
    await expect(talk(page).getByText('Herkes geldi mi')).toHaveCount(0)
    await expect(talk(page).locator('img')).toHaveCount(4)
    await expect(talk(page).getByText('Gece yarısına az kaldı')).toHaveCount(0)
    await talk(page).getByRole('button', { name: 'Show 7 later messages' }).click()
    await expect(talk(page).getByText('Dileğimi tuttum')).toBeVisible()
    await expect(talk(page).getByRole('heading', { level: 3 })).toHaveText('Sunday, July 22, 2018')
    await talk(page).getByRole('button', { name: 'Show 3 earlier messages' }).click()
    await expect(talk(page).getByText('Herkes geldi mi')).toBeVisible()
    await expectNoSidewaysScroll(page)
  })
})

test.describe('with the browser set to Turkish', () => {
  test.use({ locale: 'tr-TR' })

  test('says in Turkish how many messages each button shows', async ({ page }) => {
    await page.goto(addPerson(fruit('Karpuz')))
    await openFoundHere(page, 'batımı', /21 Temmuz 2018/, 'Ara')
    const turkish = page.getByRole('region', { name: 'Konuşma' })
    await expect(turkish.getByRole('button', { name: '3 önceki mesajı göster' })).toBeVisible()
    await expect(turkish.getByRole('button', { name: '7 sonraki mesajı göster' })).toBeVisible()
  })
})

test.describe('on a PC', () => {
  test('the stage stays on the left while the column on the right scrolls', async ({ browser }) => {
    const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')))
    await openFoundHere(page, 'hepsi', /June 12, 2016/)

    const photo = (await stage(page).locator('img').boundingBox())!
    const column = (await page.getByRole('heading', { level: 1 }).boundingBox())!
    // Side by side: the photo ends where the column begins, and both start near the top.
    expect(photo.x + photo.width).toBeLessThanOrEqual(column.x)
    expect(Math.abs(photo.y - column.y)).toBeLessThan(200)
    const beforeScroll = (await squares(page).first().boundingBox())!
    await page.mouse.move(1200, 500)
    await page.mouse.wheel(0, 400)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    const after = (await squares(page).first().boundingBox())!
    expect(after.y).toBe(beforeScroll.y)
    expect((await page.getByRole('heading', { level: 1 }).boundingBox())!.y).toBeLessThan(column.y)
    await context.close()
  })

  test('the column is 420 px wide', async ({ browser }) => {
    const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')))
    await openFoundHere(page, 'hepsi', /June 12, 2016/)

    const comments = page.getByRole('region', { name: 'Comments' })
    const right = (await comments.boundingBox())!
    // The column holds 24 px of padding on each side.
    expect(Math.round(right.width)).toBe(420 - 1 - 48)
    await context.close()
  })

  test('the left and right arrow keys move between the photos', async ({ browser }) => {
    const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')))
    await openFoundHere(page, 'hepsi', /June 12, 2016/)

    await expect(stage(page).getByText('1 / 8')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(stage(page).getByText('3 / 8')).toBeVisible()
    await expect(squares(page).nth(2)).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(stage(page).getByText('2 / 8')).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(stage(page).getByText('1 / 8')).toBeVisible()
    await context.close()
  })

  test('a photo in the conversation shows on the stage; the stage opens full screen', async ({ browser }) => {
    const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')))
    await openFoundHere(page, 'hepsi', /June 12, 2016/)

    await talk(page).getByRole('button', { name: 'Open photo 5' }).click()
    await expect(stage(page).getByText('5 / 8')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await stage(page).locator('img').click()
    await expect(page.getByRole('dialog', { name: 'Photo' }).getByText('5 / 8')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('dialog', { name: 'Photo' }).getByText('6 / 8')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await context.close()
  })

  for (const width of [900, 1440, 1920]) {
    test(`does not scroll sideways at ${width} px`, async ({ browser }) => {
      const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')), { width })
      await openFoundHere(page, 'hepsi', /June 12, 2016/)
      await expectNoSidewaysScroll(page)
      await context.close()
    })
  }
})
