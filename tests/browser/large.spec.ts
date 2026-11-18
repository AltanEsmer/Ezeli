// The timeline with a few thousand memories behind it (large.setup.ts). The page holds only the
// memories near the screen however far the friend goes, every memory is reached once and in
// order from either end, a far month opens around itself, and coming back from a memory returns
// to it. What is expected is read from the database, never counted by hand.
import { type Page, expect, test } from '@playwright/test'
import { localStack } from '../stack.ts'
import { large } from './large.ts'
import { addPerson, fruit, ownerCommand } from './support.ts'

test.setTimeout(300_000)

const stack = localStack()
const memories = (page: Page) => page.getByRole('article')
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Jump to a year or month' })
// The most memories (and photos) the page may hold at once: a screen or two of them, not thousands.
const MOST_MEMORIES = 80
const MOST_PHOTOS = 120

// Every memory of the archive in the timeline's order, as the database has them.
async function expectedKeys(): Promise<string[]> {
  const keys: string[] = []
  for (let from = 0; ; from += 1000) {
    const read = await fetch(`${stack.apiUrl}/rest/v1/timeline?select=key&order=local_at.desc,key.desc&limit=1000&offset=${from}`, { headers: { apikey: stack.secretKey } })
    const rows = (await read.json()) as { key: string }[]
    keys.push(...rows.map((row) => row.key))
    if (rows.length < 1000) return keys
  }
}

async function open(page: Page, name = fruit('Karpuz')) {
  await page.goto(addPerson(name))
  await expect(memories(page).first()).toBeVisible()
}

// Scrolls the whole way in one direction, a bit less than the part of the page that is held at a
// time, and returns every memory met, in the order of the screen, with the most held at once.
// It stops the test at once if a memory is doubled in the page or a month's heading comes back.
async function sweep(page: Page, direction: 'down' | 'up') {
  return page.evaluate(async (way) => {
    const frames = () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
    const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))
    const order: string[] = []
    const seen = new Set<string>()
    let mostMemories = 0
    let mostPhotos = 0
    let steady = 0
    let before = ''
    for (let step = 0; step < 6000; step += 1) {
      const keys = [...document.querySelectorAll<HTMLElement>('article[data-key]')].map((card) => card.dataset.key!)
      if (new Set(keys).size !== keys.length) throw new Error('a memory is in the page twice')
      const months = [...document.querySelectorAll<HTMLElement>('section[data-month]')].map((section) => section.dataset.month!).filter((month, i, all) => month !== all[i - 1])
      if (new Set(months).size !== months.length) throw new Error(`a month comes back: ${months.join(' ')}`)
      mostMemories = Math.max(mostMemories, keys.length)
      mostPhotos = Math.max(mostPhotos, document.querySelectorAll('img').length)
      const fresh = keys.filter((key) => !seen.has(key))
      for (const key of fresh) seen.add(key)
      if (way === 'down') order.push(...fresh)
      else order.unshift(...fresh)

      const atEnd = way === 'down' ? scrollY + innerHeight >= document.documentElement.scrollHeight - 4 : scrollY <= 0
      const now = `${document.documentElement.scrollHeight}:${keys.length}:${seen.size}`
      steady = atEnd && now === before ? steady + 1 : 0
      before = now
      if (steady >= 5) break
      scrollBy(0, way === 'down' ? 2500 : -2500)
      // Wait until what is held has stopped changing: the memories near the screen are in the page.
      let held = -1
      for (let calm = 0, waited = 0; calm < 3 && waited < 100; waited += 1) {
        await frames()
        await pause(10)
        const now = document.querySelectorAll('article').length
        calm = now === held && !document.querySelector('.more [role="status"]') ? calm + 1 : 0
        held = now
      }
    }
    return { order, mostMemories, mostPhotos }
  }, direction)
}

function differs(found: string[], expected: string[]): string {
  const at = expected.findIndex((key, i) => found[i] !== key)
  return at < 0 && found.length === expected.length ? 'same' : `first difference at ${at} of ${expected.length} (found ${found.length}): expected ${expected.slice(at, at + 3)}, found ${found.slice(at, at + 3)}`
}

test('scrolling from the newest to the oldest meets every memory once, in order, with few in the page', async ({ page }) => {
  const expected = await expectedKeys()
  // The big chat, the memories at one moment, and the others the earlier tests imported.
  expect(expected.length).toBeGreaterThan(large.memories + large.ties)
  await open(page)
  expect(await memories(page).count()).toBeLessThan(MOST_MEMORIES)

  const { order, mostMemories, mostPhotos } = await sweep(page, 'down')
  expect(differs(order, expected)).toBe('same')
  expect(mostMemories).toBeLessThan(MOST_MEMORIES)
  expect(mostPhotos).toBeLessThan(MOST_PHOTOS)
  // At the very end: the oldest memory of the big chat's first month, under its own heading.
  await expect(page.locator('section[data-month]').last()).toHaveAttribute('data-month', '2017-01')
  expect(await memories(page).count()).toBeLessThan(MOST_MEMORIES)
  console.log(`memories ${expected.length}, most memories in the page at once ${mostMemories}, most photos ${mostPhotos}, elements now ${await page.evaluate(() => document.getElementsByTagName('*').length)}`)
})

test('a jump opens around the month, and scrolling back up reaches the newest memory, none skipped or doubled', async ({ page }) => {
  const expected = await expectedKeys()
  await open(page)

  // The oldest year is thousands of memories away: the jump loads around it only.
  await tabs(page).getByRole('button', { name: '2017', exact: true }).click()
  await tabs(page).getByRole('button', { name: 'March 2017' }).click()
  const heading = page.getByRole('heading', { name: 'March 2017' })
  await expect(heading).toBeInViewport()
  // Keyboard focus is on the month it jumped to.
  await expect(heading).toBeFocused()
  expect(await memories(page).count()).toBeLessThan(MOST_MEMORIES)

  const { order, mostMemories } = await sweep(page, 'up')
  expect(differs(order, expected.slice(0, order.length))).toBe('same')
  // Scrolling up to the top reaches the newest memory.
  expect(order[0]).toBe(expected[0])
  expect(mostMemories).toBeLessThan(MOST_MEMORIES)
})

test('the year tabs reach every year of eleven on a small screen, and show that the strip scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 })
  await open(page)

  const strip = tabs(page)
  const years = await strip.getByRole('button', { name: /^\d{4}$/ }).count()
  expect(years).toBeGreaterThanOrEqual(large.years)
  // The strip is taller than its box, so it scrolls, and it says so with a fade at the end.
  expect(await strip.evaluate((nav) => nav.scrollHeight > nav.clientHeight)).toBe(true)
  await expect(strip).toHaveAttribute('data-more-down', 'true')

  // The oldest year is reached from the newest, and so is its oldest month, though the strip must scroll.
  await strip.getByRole('button', { name: '2017', exact: true }).click()
  await expect(strip.getByRole('button', { name: '2017', exact: true })).toHaveAttribute('aria-current', 'true')
  await strip.getByRole('button', { name: 'January 2017' }).click()
  await expect(page.getByRole('heading', { name: 'January 2017' })).toBeInViewport()
  await expect(strip).toHaveAttribute('data-more-up', 'true')
})

test('coming back from a memory returns to it, though it is far from the newest', async ({ page }) => {
  await open(page)
  await tabs(page).getByRole('button', { name: '2019', exact: true }).click()
  await tabs(page).getByRole('button', { name: 'July 2019' }).click()
  await expect(page.getByRole('heading', { name: 'July 2019' })).toBeInViewport()
  // Scroll on a little, to a memory that is neither the first of the month nor on screen at the top.
  await memories(page).nth(6).scrollIntoViewIfNeeded()
  const card = memories(page).nth(6)
  const key = await card.getAttribute('data-key')
  const date = await card.getByRole('heading').textContent()

  await card.getByRole('link').click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(date!)
  await page.goBack()
  const same = page.locator(`article[data-key="${key}"]`)
  await expect(same).toBeInViewport({ ratio: 0.5 })
  expect(await memories(page).count()).toBeLessThan(MOST_MEMORIES)

  // By the button too, and the memories above and below it load as they are reached.
  await same.getByRole('link').click()
  await page.getByRole('button', { name: 'All memories' }).click()
  await expect(page.locator(`article[data-key="${key}"]`)).toBeInViewport({ ratio: 0.5 })
  await page.evaluate(() => scrollBy(0, -5000))
  await expect.poll(() => memories(page).count()).toBeGreaterThan(0)
})

test('says so when a page cannot be loaded, and loads it when tried again', async ({ page }) => {
  await open(page)
  const alert = page.getByRole('alert')
  const pages = '**/rest/v1/rpc/timeline_page'

  // More below fails: one line and a button, then the same page loads.
  await page.route(pages, (route) => route.abort())
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  await expect(alert).toContainText('Could not load')
  const before = await page.locator('[data-chunk]').count()
  await page.unroute(pages)
  await alert.getByRole('button', { name: 'Try again' }).click()
  await expect(alert).toHaveCount(0)
  await expect.poll(() => page.locator('[data-chunk]').count()).toBeGreaterThan(before)

  // A jump that fails says so near the friend, and trying again makes the jump.
  await page.route(pages, (route) => route.abort())
  await tabs(page).getByRole('button', { name: '2017', exact: true }).click()
  await expect(alert).toContainText('Could not load')
  await page.unroute(pages)
  await alert.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: /2017$/ }).first()).toBeInViewport()
  await expect(alert).toHaveCount(0)
})

test('shows the private page when the session ends while scrolling, not an end of the archive', async ({ page }) => {
  const name = fruit('Karpuz')
  await open(page, name)
  expect(ownerCommand(['person', 'relink', '--name', name]).status).toBe(0)

  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  await expect(page.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()
})

// The memories a person took part in, in the timeline's order, read from the tables themselves
// (never through the functions the screen uses): memories where they sent a photo or a message.
async function expectedPersonKeys(slug: string): Promise<string[]> {
  const get = async <T>(path: string): Promise<T[]> => {
    const rows: T[] = []
    for (let from = 0; ; from += 1000) {
      const read = await fetch(`${stack.apiUrl}/rest/v1/${path}&limit=1000&offset=${from}`, { headers: { apikey: stack.secretKey } })
      const page = (await read.json()) as T[]
      rows.push(...page)
      if (page.length < 1000) return rows
    }
  }
  const [who] = await get<{ id: string }>(`people?select=id&slug=eq.${slug}`)
  const took = new Set<string>()
  for (const table of ['messages', 'photos']) {
    for (const row of await get<{ memory_id: string }>(`${table}?select=memory_id&person_id=eq.${who!.id}&order=id`)) took.add(row.memory_id)
  }
  const all = await get<{ id: string; key: string }>('timeline?select=id,key&order=local_at.desc,key.desc')
  return all.filter((row) => took.has(row.id)).map((row) => row.key)
}

test("a person's page scrolls through only their memories, once each and in order, with few in the page", async ({ page }) => {
  const expected = await expectedPersonKeys('limon')
  expect(expected.length).toBeGreaterThan(large.memories / 2)
  await open(page)
  const first = Date.now()
  await page.goto('/p/limon')
  // The timeline under the facts appears about as fast as the main one does, not seconds later.
  await expect(memories(page).first()).toBeVisible({ timeout: 2000 })
  console.log(`person page: first memory after ${Date.now() - first} ms`)

  const { order, mostMemories } = await sweep(page, 'down')
  expect(differs(order, expected)).toBe('same')
  expect(mostMemories).toBeLessThan(MOST_MEMORIES)
})

test("a jump on a person's page opens around one of their older months, and scrolling up reaches their newest", async ({ page }) => {
  const expected = await expectedPersonKeys('limon')
  await open(page)
  await page.goto('/p/limon')
  await expect(memories(page).first()).toBeVisible()

  await tabs(page).getByRole('button', { name: '2017', exact: true }).click()
  await tabs(page).getByRole('button', { name: 'March 2017' }).click()
  await expect(page.getByRole('heading', { name: 'March 2017' })).toBeInViewport()
  expect(await memories(page).count()).toBeLessThan(MOST_MEMORIES)

  const { order, mostMemories } = await sweep(page, 'up')
  expect(differs(order, expected.slice(0, order.length))).toBe('same')
  expect(order[0]).toBe(expected[0])
  expect(mostMemories).toBeLessThan(MOST_MEMORIES)
})
