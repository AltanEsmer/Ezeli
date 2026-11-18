// The people page and a person's page, on the memories the earlier projects imported (the people
// file ids: karpuz, limon, fistik, cilek, incir). Limon sent photos under two names ("Limon L",
// "Limon 🌻") and on Discord, and has one page. Çilek and İncir wrote but sent no photo. People made
// with `person add` have no lasting id and are not part of the group's pages.
import { type Page, expect, test } from '@playwright/test'
import { addPerson, apiUrl, fruit, ownerCommand, publishableKey } from './support.ts'

const articles = (page: Page) => page.getByRole('article')

async function signIn(page: Page) {
  await page.goto(addPerson(fruit('Karpuz')))
  await expect(articles(page).first()).toBeVisible()
}

const accessToken = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.endsWith('-auth-token'))!
    return JSON.parse(localStorage.getItem(key)!).access_token as string
  })

test.describe('the people page', () => {
  test('is reached from the timeline header and lists every person with the photos they sent', async ({ page }) => {
    await signIn(page)

    await page.getByRole('link', { name: 'People' }).click()

    await expect(page).toHaveURL(/\/people$/)
    const cards = page.getByRole('list', { name: 'People' }).getByRole('listitem')
    await expect(cards.getByRole('heading')).toHaveText(['Çilek', 'Fıstık', 'İncir', 'Karpuz', 'Limon'])
    // A few photos, the most recent: at most four, none for a person with none.
    await expect(cards.filter({ hasText: 'Limon' }).locator('img')).toHaveCount(4)
    await expect(cards.filter({ hasText: 'Karpuz' }).locator('img')).toHaveCount(4)
    await expect(cards.filter({ hasText: 'İncir' }).locator('img')).toHaveCount(0)
    await expect(cards.filter({ hasText: 'İncir' })).toContainText('No photos yet')
    for (const photo of await cards.filter({ hasText: 'Limon' }).locator('img').all()) {
      await expect(photo).toHaveJSProperty('complete', true)
      expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    }
  })

  test('opens a person by their name', async ({ page }) => {
    await signIn(page)
    await page.getByRole('link', { name: 'People' }).click()

    await page.getByRole('link', { name: /Fıstık/ }).click()

    await expect(page).toHaveURL(/\/p\/fistik$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fıstık')
  })
})

test.describe("a person's page", () => {
  test('shows the name, the first and latest memory, how many photos, and one page for two names', async ({ page }) => {
    await signIn(page)
    await page.goto('/p/limon')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Limon')
    await expect(page.getByText('6 photos sent')).toBeVisible()
    await expect(page.getByText('Saturday, August 3, 2019').first()).toBeVisible()
    await expect(page.locator('.facts')).toContainText('Saturday, September 2, 2023')
  })

  test('shows a person who sent no photo, with the memories they wrote in', async ({ page }) => {
    await signIn(page)
    await page.goto('/p/cilek')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Çilek')
    await expect(page.locator('.facts')).toContainText('No photos yet')
    await expect(articles(page)).toHaveCount(1)
    await expect(articles(page).getByRole('heading')).toHaveText('Saturday, August 3, 2019')
  })

  test('is a timeline of only their memories, with month headings and tabs, newest first', async ({ page }) => {
    await signIn(page)
    await page.goto('/p/limon')

    await expect(articles(page).getByRole('heading')).toHaveText([
      'Saturday, September 2, 2023',
      'Friday, July 14, 2023',
      'Sunday, March 5, 2023',
      'Sunday, January 22, 2023',
      'Tuesday, January 10, 2023',
      'Thursday, December 1, 2022',
      'Thursday, November 10, 2022',
      'Saturday, August 3, 2019',
    ])
    await expect(page.locator('section[data-month="2023-07"] h2')).toHaveText('July 2023')
    // The tabs are this person's months only.
    const tabs = page.getByRole('navigation', { name: 'Jump to a year or month' })
    await expect(tabs.getByRole('button', { name: '2019' })).toBeVisible()
    await expect(tabs.getByRole('button', { name: '2021' })).toHaveCount(0)
  })

  test('opens a memory and comes back to the same place', async ({ page }) => {
    await signIn(page)
    await page.goto('/p/limon')
    const january = articles(page).filter({ hasText: 'January 10, 2023' })
    await january.scrollIntoViewIfNeeded()
    await january.getByRole('link').click()
    await expect(page).toHaveURL(/\/m\//)

    await page.goBack()

    await expect(page).toHaveURL(/\/p\/limon$/)
    await expect(january).toBeInViewport()
    // The place is kept, not the start.
    await expect(articles(page).first()).not.toBeInViewport()
  })

  test('says so when the person is not there', async ({ page }) => {
    await signIn(page)
    await page.goto('/p/nobody')

    await expect(page.getByRole('heading', { name: 'This person is not here' })).toBeVisible()
  })
})

test.describe('a name in a memory', () => {
  test('opens that person, in the conversation and under a photo', async ({ page }) => {
    await signIn(page)
    await articles(page).first().getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saturday, September 2, 2023')

    await page.locator('.talk .who').getByRole('link', { name: 'Limon' }).first().click()
    await expect(page).toHaveURL(/\/p\/limon$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Limon')

    await page.goBack()
    await page.locator('.prints .cap').getByRole('link', { name: 'Fıstık' }).first().click()
    await expect(page).toHaveURL(/\/p\/fistik$/)
  })
})

test.describe('what is readable', () => {
  test('is only the name, the lasting id and the photos, and nothing to a visitor or an ended session', async ({ browser, request }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    const name = fruit('Karpuz')
    await page.goto(addPerson(name))
    await expect(articles(page).first()).toBeVisible()
    const headers = { apikey: publishableKey, authorization: `Bearer ${await accessToken(page)}`, 'content-type': 'application/json' }
    const call = (h: Record<string, string>, fn: string, data: object = {}) => request.post(`${apiUrl}/rest/v1/rpc/${fn}`, { headers: h, data })

    const people = (await (await call(headers, 'people_page')).json()) as { id: string }[]
    expect(people.map((p) => p.id).sort()).toEqual(['cilek', 'fistik', 'incir', 'karpuz', 'limon'])
    for (const person of people) expect(Object.keys(person).sort()).toEqual(['id', 'name', 'photo_count', 'photos'])
    const one = await (await call(headers, 'person_page', { p_person: 'limon' })).json()
    expect(Object.keys(one).sort()).toEqual(['first', 'id', 'last', 'name', 'photo_count'])
    // Someone made by `person add` has no lasting id and no page.
    expect(await (await call(headers, 'person_page', { p_person: name })).json()).toBeNull()

    // A visitor may not call them at all.
    const visitor = { apikey: publishableKey, 'content-type': 'application/json' }
    const listing = { p_newer: false, p_at: null, p_key: null, p_limit: 5, p_person: 'limon' }
    for (const [fn, data] of [['people_page', {}], ['person_page', { p_person: 'limon' }], ['person_months', { p_person: 'limon' }], ['timeline_page', listing]] as const) {
      expect((await call(visitor, fn, data)).ok(), fn).toBe(false)
    }

    // The link is replaced: the old token is still inside its lifetime but its session is gone.
    expect(ownerCommand(['person', 'relink', '--name', name]).status).toBe(0)
    expect(await (await call(headers, 'people_page')).json()).toEqual([])
    expect(await (await call(headers, 'person_page', { p_person: 'limon' })).json()).toBeNull()
    expect(await (await call(headers, 'person_months', { p_person: 'limon' })).json()).toEqual([])
    expect(await (await call(headers, 'timeline_page', listing)).json()).toEqual([])
    await context.close()
  })
})
