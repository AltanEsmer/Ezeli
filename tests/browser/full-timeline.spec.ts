// What the full timeline shows for a memory, on small made-up data: the headings, the line of the
// conversation, the counts, the tabs and the photo places. The data is what the earlier projects
// imported (July, March, January and February 2023, September 2023) plus two chats imported here:
// one on 1 December 2022 whose messages all come before its photo, one on 10 November 2022 whose
// photo has a caption. Nothing here counts the memories of the others, so a new fixture elsewhere
// changes nothing.
import { type Page, expect, test } from '@playwright/test'
import { addPerson, commentCount, counts, fruit, ownerCommand, photoCount, quotedLine } from './support.ts'

const fixtures = 'tests/fixtures/whatsapp-iphone'
const memories = (page: Page) => page.getByRole('article')
const month = (page: Page, key: string) => page.locator(`section[data-month="${key}"]`)
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Jump to a year or month' })

test.beforeAll(() => {
  for (const [folder, chat] of [['line-before', 'Akşam Yemeği'], ['caption', 'Kıyı Notu']] as const) {
    const result = ownerCommand(['import', `${fixtures}/${folder}`, '--people', `${fixtures}/people.json`, '--timezone', 'Europe/Istanbul', '--chat', chat, '--date-order', 'day-first'])
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  }
})

async function openTimeline(page: Page) {
  await page.goto(addPerson(fruit('Karpuz')))
  await expect(memories(page).first()).toBeVisible()
}

test.describe('the full timeline', () => {
  test('groups the memories under month and year headings', async ({ page }) => {
    await openTimeline(page)

    await expect(month(page, '2023-07').getByRole('heading', { level: 2 })).toHaveText('July 2023')
    await expect(month(page, '2023-07').getByRole('article')).toHaveCount(2)
    await expect(month(page, '2023-03').getByRole('heading', { level: 2 })).toHaveText('March 2023')
    await expect(month(page, '2022-12').getByRole('heading', { level: 2 })).toHaveText('December 2022')
  })

  test('shows one line of the conversation as it was written, and the photo and comment counts', async ({ page }) => {
    await openTimeline(page)
    const fifteenth = month(page, '2023-07').getByRole('article').first()
    const fourteenth = month(page, '2023-07').getByRole('article').nth(1)
    const march = month(page, '2023-03').getByRole('article')
    const december = month(page, '2022-12').getByRole('article')

    // The first text message at or after the first photo...
    await expect(quotedLine(fifteenth)).toHaveText('“Şu suyun rengine bak”')
    await expect(quotedLine(fourteenth)).toHaveText('“Çok güzel çıkmış! Işık şahane”')
    // ...no line when the memory has no text message...
    await expect(quotedLine(march)).toHaveCount(0)
    // ...and the last one before the photo when none comes after it, cut at a word when long.
    const full = 'Akşam yemeği için sofrayı kurduk, herkes geldi, çorba çıktı, ardından balık geldi ve tatlıya kadar kimse kalkmadı çünkü sohbet çok güzeldi 🍉🍉🍉 ve bir de çay içtik'
    const shown = (await quotedLine(december).innerText()).slice(1, -1)
    expect(shown.endsWith('…')).toBe(true)
    expect(shown).not.toContain('en eski')
    expect(full.startsWith(shown.slice(0, -1))).toBe(true)
    expect(shown.slice(0, -1)).not.toMatch(/\s$|[,.]$/)
    expect(shown.length).toBeLessThan(full.length / 1.5)
    // The line is set by its own letters, so a right-to-left line reads right.
    await expect(quotedLine(december)).toHaveAttribute('dir', 'auto')

    // (The July memories may carry comments from the comment tests, so only March says "No comments".)
    await expect(photoCount(fifteenth)).toHaveText('1 photo')
    await expect(photoCount(fourteenth)).toHaveText('2 photos')
    await expect(counts(march)).toHaveText(['3 photos', 'No comments'])
  })

  test('counts the comments of a memory: one after a friend adds one, none after it is deleted', async ({ page }) => {
    const dinner = month(page, '2022-12').getByRole('article')
    await openTimeline(page)
    await expect(commentCount(dinner)).toHaveText('No comments')

    await dinner.getByRole('link').click()
    await page.getByRole('textbox').fill('bir not')
    await page.getByRole('button', { name: 'Add comment' }).click()
    const note = page.getByRole('article').filter({ hasText: 'bir not' })
    await expect(note).toBeVisible()
    await page.getByRole('button', { name: 'All memories' }).click()
    await expect(commentCount(dinner)).toHaveText('1 comment')

    await dinner.getByRole('link').click()
    await note.getByRole('button', { name: 'Delete' }).click()
    await note.getByRole('button', { name: 'Yes, delete' }).click()
    await expect(note).toHaveCount(0)
    await page.getByRole('button', { name: 'All memories' }).click()
    await expect(commentCount(dinner)).toHaveText('No comments')
  })

  test('takes a photo\'s caption as the line, by the same rule as any text message', async ({ page }) => {
    await openTimeline(page)

    // The caption is sent with the first photo, so it comes before the text that follows it, and
    // the text that came before the photo is not chosen.
    await expect(quotedLine(month(page, '2022-11').getByRole('article'))).toHaveText('“Kıyıda akşam altyazısı”')
  })

  test('jumps to a month, or to a year, with the tabs on the right edge', async ({ page }) => {
    await openTimeline(page)

    // The open tab is the year on screen; its months show under it.
    await expect(tabs(page).getByRole('button', { name: '2023', exact: true })).toHaveAttribute('aria-current', 'true')
    await expect(tabs(page).getByRole('button', { name: 'March 2023' })).toBeVisible()

    const march = page.getByRole('heading', { name: 'March 2023' })
    await tabs(page).getByRole('button', { name: 'March 2023' }).click()
    await expect.poll(async () => (await march.boundingBox())?.y ?? 9999).toBeLessThan(60)
    await expect(tabs(page).getByRole('button', { name: 'March 2023' })).toHaveAttribute('aria-current', 'true')

    await tabs(page).getByRole('button', { name: '2022', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'December 2022' })).toBeInViewport()
    await expect(tabs(page).getByRole('button', { name: '2022', exact: true })).toHaveAttribute('aria-current', 'true')
    await expect(tabs(page).getByRole('button', { name: 'December 2022' })).toBeVisible()
  })

  test('a photo holds its place at its real shape while it loads and when it fails', async ({ browser, page }) => {
    const heights = (on: Page) => memories(on).locator('[data-photo]').evaluateAll((boxes) => boxes.map((box) => Math.round(box.getBoundingClientRect().height)))
    await openTimeline(page)
    await expect(memories(page).locator('img').first()).toHaveJSProperty('complete', true)
    const loaded = await heights(page)
    const count = await memories(page).count()

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
    await expect(memories(holding)).toHaveCount(count)
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
    await expect(failing.getByText('Photo could not load').first()).toBeVisible()
    expect(await heights(failing)).toEqual(loaded)
    await broken.close()
  })

  test.describe('with the browser set to Turkish', () => {
    test.use({ locale: 'tr-TR' })

    test('reads the headings, the tabs and the counts in Turkish, and the conversation line as written', async ({ page }) => {
      await openTimeline(page)

      await expect(month(page, '2023-07').getByRole('heading', { level: 2 })).toHaveText('Temmuz 2023')
      await expect(month(page, '2022-12').getByRole('heading', { level: 2 })).toHaveText('Aralık 2022')
      await expect(page.getByRole('navigation', { name: 'Bir yıla ya da aya git' }).getByRole('button', { name: 'Mart 2023' })).toBeVisible()
      const first = month(page, '2023-07').getByRole('article').first()
      await expect(photoCount(first)).toHaveText('1 fotoğraf')
      await expect(commentCount(month(page, '2023-03').getByRole('article'))).toHaveText('Yorum yok')
      await expect(quotedLine(first)).toHaveText('“Şu suyun rengine bak”')
    })
  })
})
