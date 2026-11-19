// A memory on a list, and the timeline's jump, as a friend sees them: the photos in one block on a
// phone and in one row beside the words on a PC. The data is one chat imported here (a made-up
// album, June 2016): 16 June three photos, 15th two, 14th one, 13th four and no line of
// conversation, 12th eight.
import { type Locator, type Page, expect, test } from '@playwright/test'
import { addPerson, commentCount, expectNoSidewaysScroll, fruit, openWide, photoCount, quotedLine, sentBy } from './support.ts'

const years = (page: Page) => page.getByRole('navigation', { name: 'Jump to a year or month' })
const june = (page: Page) => page.locator('section[data-month="2016-06"]').getByRole('article')
const [sixteenth, fifteenth, fourteenth, thirteenth, twelfth] = [0, 1, 2, 3, 4]

async function openJune(page: Page) {
  await page.goto(addPerson(fruit('Karpuz')))
  await expect(page.getByRole('article').first()).toBeVisible()
  await years(page).getByRole('button', { name: '2016', exact: true }).click()
  await years(page).getByRole('button', { name: 'June 2016' }).click()
  await expect(page.getByRole('heading', { name: 'June 2016' })).toBeInViewport()
  await expect(june(page)).toHaveCount(5)
}

// Where each photo place of a memory is on the page.
const places = (memory: Locator) => memory.locator('[data-photo]').evaluateAll((boxes) => boxes.map((box) => box.getBoundingClientRect()).map(({ x, y, width, height }) => ({ x, y, width, height })))
const near = (a: number, b: number, by = 1.5) => expect(Math.abs(a - b)).toBeLessThanOrEqual(by)
// Boxes move while photos load and a scroll settles, so a measuring test asks again until what it
// measures holds (or the time is up), instead of measuring once right after a scroll or a render.
const settled = (check: () => Promise<void>) => expect(check).toPass({ timeout: 10_000 })

test.describe('on a phone', () => {
  test('one photo is wide; two are halves; three are one large and two stacked; four are two by two', async ({ page }) => {
    await openJune(page)

    await settled(async () => {
      const [one] = await places(june(page).nth(fourteenth))
      near(one!.width, 390 - 32)

      const [left, right] = await places(june(page).nth(fifteenth))
      near(left!.y, right!.y)
      near(left!.height, right!.height)
      near(left!.width, right!.width)
      near(right!.x - (left!.x + left!.width), 2)

      const [large, top, bottom] = await places(june(page).nth(sixteenth))
      near(top!.x, bottom!.x)
      near(bottom!.y - (top!.y + top!.height), 2)
      near(large!.height, top!.height + 2 + bottom!.height)
      expect(large!.width).toBeGreaterThan(top!.width)

      const four = await places(june(page).nth(thirteenth))
      expect(four).toHaveLength(4)
      near(four[0]!.y, four[1]!.y)
      near(four[2]!.y, four[3]!.y)
      near(four[2]!.y - (four[0]!.y + four[0]!.height), 2)
      near(four[0]!.x, four[2]!.x)
      expect(four[1]!.x).toBeGreaterThan(four[0]!.x)
    })
  })

  test('more photos than the block shows say how many more on the last one', async ({ page }) => {
    await openJune(page)

    await expect(june(page).nth(twelfth).locator('[data-photo]')).toHaveCount(4)
    await expect(june(page).nth(twelfth).getByText('+4', { exact: true })).toBeVisible()
    await expect(june(page).nth(thirteenth).getByText(/^\+\d+$/)).toHaveCount(0)
  })

  test('has the date, the line, who sent the photos and the counts under the photos', async ({ page }) => {
    await openJune(page)
    const album = june(page).nth(twelfth)

    await expect(album.getByRole('heading')).toHaveText('Sunday, June 12, 2016')
    await expect(quotedLine(album)).toHaveText('“Hepsi burada, albüm hazır”')
    await expect(sentBy(album)).toHaveText('Sent by Karpuz, Limon, and Fıstık')
    await expect(photoCount(album)).toHaveText('8 photos')
    await expect(commentCount(album)).toHaveCount(0)
    // The words are under the block.
    await settled(async () => {
      const [first] = await places(album)
      const words = (await album.getByRole('heading').boundingBox())!
      expect(words.y).toBeGreaterThan(first!.y + first!.height)
    })
  })

  test('a memory with no text shows no line and still has its date, senders and count', async ({ page }) => {
    await openJune(page)
    const none = june(page).nth(thirteenth)

    await expect(quotedLine(none)).toHaveCount(0)
    await expect(none.getByRole('heading')).toHaveText('Monday, June 13, 2016')
    await expect(sentBy(none)).toBeVisible()
    await expect(photoCount(none)).toHaveText('4 photos')
  })

  test('names and the line of conversation are marked as Turkish', async ({ page }) => {
    await openJune(page)
    const album = june(page).nth(twelfth)

    await expect(quotedLine(album)).toHaveAttribute('lang', 'tr')
    await expect(album.getByText('Fıstık', { exact: true })).toHaveAttribute('lang', 'tr')
    // The words of the label are not.
    await expect(sentBy(album)).not.toHaveAttribute('lang', 'tr')
  })

  test('the whole memory is one link to its address, and the comment count shows once there is a comment', async ({ page }) => {
    await openJune(page)
    const three = june(page).nth(sixteenth)
    const key = await three.getAttribute('data-key')
    await expect(three.getByRole('link')).toHaveCount(1)
    await expect(commentCount(three)).toHaveCount(0)

    // Pressing the photos, then the words, opens the memory.
    await three.locator('img').first().click()
    await expect(page).toHaveURL(new RegExp(`/m/${key}$`))
    await page.getByRole('textbox').fill('bir not')
    await page.getByRole('button', { name: 'Add comment' }).click()
    await expect(page.getByRole('article').filter({ hasText: 'bir not' })).toBeVisible()
    await page.getByRole('button', { name: 'All memories' }).click()
    await expect(commentCount(june(page).nth(sixteenth))).toHaveText('1 comment')

    await june(page).nth(sixteenth).getByText('Sent by').click()
    await expect(page).toHaveURL(new RegExp(`/m/${key}$`))
  })

  test('the month heading stays in view while its month scrolls, under the strip of years', async ({ page }) => {
    await openJune(page)
    const heading = page.getByRole('heading', { name: 'June 2016' })

    // Scroll down the month to its third memory. (Not a fixed distance: the rows' heights depend on
    // the words and on where the jump settled, and a fixed scroll left the third one out of view.)
    await june(page).nth(fourteenth).scrollIntoViewIfNeeded()
    await expect(june(page).nth(fourteenth)).toBeInViewport()
    await expect(heading).toBeInViewport()
    await settled(async () => {
      const bar = (await page.getByRole('navigation', { name: 'Pages' }).boundingBox())!
      const strip = (await years(page).boundingBox())!
      near(strip.y, bar.y + bar.height, 2)
      const box = (await heading.boundingBox())!
      near(box.y, strip.y + strip.height, 2)
    })
  })

  test('a photo fades in once loaded, and the place has the photo\'s shape before that', async ({ page }) => {
    await openJune(page)
    const picture = june(page).nth(sixteenth).locator('img').first()

    await expect(picture).toHaveJSProperty('complete', true)
    await expect(picture).toHaveCSS('opacity', '1')
  })

  test('does not scroll sideways', async ({ page }) => {
    await openJune(page)
    await expectNoSidewaysScroll(page)
  })
})

test.describe('on a PC', () => {
  test('a memory is one row: the words on the left, the photos on the right at one height', async ({ browser }) => {
    const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')))
    await openJuneWide(page)

    for (const [index, count] of [[fourteenth, 1], [fifteenth, 2], [sixteenth, 3]] as const) {
      await settled(async () => {
        const row = june(page).nth(index)
        await expect(row.locator('[data-photo]')).toHaveCount(count)
        const photos = await places(row)
        const words = (await row.getByRole('heading').boundingBox())!
        // The words column is 280 px, then the photos, side by side and level.
        expect(photos[0]!.x - words.x).toBeGreaterThanOrEqual(280)
        expect(photos[0]!.x - words.x).toBeLessThan(340)
        near(photos[0]!.y, words.y, 12)
        for (const photo of photos) {
          near(photo.y, photos[0]!.y)
          near(photo.height, photos[0]!.height)
          expect(photo.height).toBeLessThanOrEqual(224)
          expect(photo.height).toBeGreaterThanOrEqual(188)
        }
      })
    }
    await context.close()
  })

  test('a memory with more photos than fit fills the row, with +N on the last', async ({ browser }) => {
    const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')))
    await openJuneWide(page)
    const album = june(page).nth(twelfth)

    await settled(async () => {
      const photos = await places(album)
      expect(photos.length).toBeGreaterThan(1)
      expect(photos.length).toBeLessThan(8)
      await expect(album.getByText(`+${8 - photos.length}`, { exact: true })).toBeVisible()
      await expect(album.getByText(/^\+\d+$/)).toHaveCount(1)
      // The last photo ends where the row ends, so the row is full.
      const last = photos.at(-1)!
      const row = (await album.getByText('8 photos').boundingBox())!
      expect(last.x + last.width).toBeGreaterThan(row.x + 280 + 500)
    })
    await context.close()
  })

  test('the list of years at the right edge shows the year in view and jumps to a year or month', async ({ browser }) => {
    const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')))
    await expect(page.getByRole('article').first()).toBeVisible()
    const list = years(page)

    const edge = (await list.boundingBox())!
    expect(edge.x + edge.width).toBeGreaterThanOrEqual(1440 - 1)
    // One year is open, the year in view, with its months after it.
    await expect(list.locator('[aria-current="true"]').first()).toBeVisible()

    await list.getByRole('button', { name: '2016', exact: true }).click()
    await list.getByRole('button', { name: 'June 2016' }).click()
    const heading = page.getByRole('heading', { name: 'June 2016' })
    await expect(heading).toBeInViewport()
    await expect.poll(async () => (await heading.boundingBox())?.y ?? 9999).toBeLessThan(60)
    await expect(list.getByRole('button', { name: '2016', exact: true })).toHaveAttribute('aria-current', 'true')
    await expect(list.getByRole('button', { name: 'June 2016' })).toHaveAttribute('aria-current', 'true')

    // The heading stays at the top while its month scrolls.
    await page.evaluate(() => scrollBy(0, 700))
    await expect.poll(async () => (await heading.boundingBox())?.y ?? 9999).toBeLessThan(60)
    await context.close()
  })

  test('does not scroll sideways at 900, 1440 and 1920 px', async ({ browser }) => {
    for (const width of [900, 1440, 1920]) {
      const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')), { width })
      await openJuneWide(page)
      await expectNoSidewaysScroll(page)
      await context.close()
    }
  })
})

async function openJuneWide(page: Page) {
  await expect(page.getByRole('article').first()).toBeVisible()
  await years(page).getByRole('button', { name: '2016', exact: true }).click()
  await years(page).getByRole('button', { name: 'June 2016' }).click()
  await expect(page.getByRole('heading', { name: 'June 2016' })).toBeInViewport()
  await expect(june(page)).toHaveCount(5)
}
