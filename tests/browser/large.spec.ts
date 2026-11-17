// The timeline with a few thousand memories behind it (large.setup.ts): it loads as the friend
// scrolls, a far month can be jumped to, and the page never holds every photo at once.
import { type Page, expect, test } from '@playwright/test'
import { large } from './large.ts'
import { addPerson, fruit } from './support.ts'
import wipe from './wipe.ts'

test.setTimeout(240_000)

// The few thousand memories are not left behind for the import tests, which read the same stack.
test.afterAll(wipe)

// The memories of the other made-up exports (import.setup.ts) are on the timeline too.
const madeUpOthers = 4

const memories = (page: Page) => page.getByRole('article')
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Jump to a year or month' })

async function open(page: Page) {
  const photoFiles: string[] = []
  page.on('request', (request) => {
    if (/\/object\/sign\/photos\/.+token=/.test(request.url())) photoFiles.push(request.url())
  })
  await page.goto(addPerson(fruit('Karpuz')))
  await expect(memories(page).first()).toBeVisible()
  return photoFiles
}

test('loads more as the friend scrolls, to the oldest memory, holding few photos at a time', async ({ page }) => {
  const photoFiles = await open(page)
  // Only the first page is loaded to begin with, and there is no next-page button.
  expect(await memories(page).count()).toBeLessThan(200)
  await expect(page.getByRole('button', { name: /next|more|daha/i })).toHaveCount(0)

  let mostPhotosAtOnce = 0
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(150)
        mostPhotosAtOnce = Math.max(mostPhotosAtOnce, await page.locator('img').count())
        return memories(page).count()
      },
      { timeout: 180_000, intervals: [100] },
    )
    .toBe(large.memories + madeUpOthers)

  // The oldest memory is at the very end, under its own year and month.
  await expect(memories(page).last().locator('.line')).toContainText('Anı 0 ')
  await expect(page.getByRole('heading', { level: 2 }).last()).toHaveText('January 2017')
  expect(mostPhotosAtOnce).toBeLessThan(80)
  // Memories far above the screen have let their photos go; the page never held them all.
  expect(await page.locator('img').count()).toBeLessThan(80)
  expect(photoFiles.length).toBeLessThan(large.memories)
  console.log(`memories ${large.memories}, photo files fetched ${photoFiles.length}, most photos in the page at once ${mostPhotosAtOnce}, elements in the page ${await page.evaluate(() => document.getElementsByTagName('*').length)}`)
})

test('jumps to a year or a month that is not loaded yet, and the photos there load', async ({ page }) => {
  await open(page)
  expect(await memories(page).count()).toBeLessThan(200)

  // 2018 is far below the first page.
  await tabs(page).getByRole('button', { name: '2018', exact: true }).click()
  const heading = page.getByRole('heading', { level: 2 }).filter({ hasText: /2018$/ }).first()
  await expect(heading).toBeInViewport()
  await expect(tabs(page).getByRole('button', { name: '2018', exact: true })).toHaveAttribute('aria-current', 'true')
  // The photos under the heading load, and the page is not holding the ones left behind.
  const photo = page.locator('img:visible').first()
  await expect(photo).toHaveJSProperty('complete', true)
  expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  expect(await page.locator('img').count()).toBeLessThan(80)

  // A month of another year, and then the oldest.
  await tabs(page).getByRole('button', { name: '2019', exact: true }).click()
  await tabs(page).getByRole('button', { name: 'July 2019' }).click()
  await expect(page.getByRole('heading', { name: 'July 2019' })).toBeInViewport()
  await tabs(page).getByRole('button', { name: '2017', exact: true }).click()
  await tabs(page).getByRole('button', { name: 'January 2017' }).click()
  await expect(page.getByRole('heading', { name: 'January 2017' })).toBeInViewport()
})
