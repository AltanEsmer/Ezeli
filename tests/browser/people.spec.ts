// The people page and a person's page, on the memories the earlier projects imported (the people
// file ids: karpuz, limon, fistik, cilek, incir). Limon sent photos under two names ("Limon L",
// "Limon 🌻") and on Discord, and has one page. Çilek and İncir wrote but sent no photo. People made
// with `person add` have no lasting id and are not part of the group's pages. people.setup.ts adds
// three January 2024 chats (two time zones, and a memory that only names Çilek). The tests look for
// these people and do not count everyone, so a later fixture with another person changes nothing.
import { type Page, expect, test } from '@playwright/test'
import { addPerson, apiUrl, expectNoSidewaysScroll, fruit, openWide, ownerCommand, publishableKey } from './support.ts'

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
    const shown = await cards.getByRole('heading').allTextContents()
    expect(shown.filter((name) => ['Çilek', 'Fıstık', 'İncir', 'Karpuz', 'Limon'].includes(name))).toEqual(['Çilek', 'Fıstık', 'İncir', 'Karpuz', 'Limon'])
    // A card's link is named by the person, not by the descriptions of their photos.
    await expect(page.getByRole('link', { name: 'Limon', exact: true })).toHaveAttribute('href', '/p/limon')
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

    await page.getByRole('link', { name: 'Fıstık', exact: true }).click()

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
    await expect(page.getByRole('definition').filter({ hasText: 'Saturday, August 3, 2019' })).toBeVisible()
    await expect(page.getByRole('definition').filter({ hasText: 'Saturday, January 20, 2024' })).toBeVisible()
  })

  test('shows a person who sent no photo, with the memories they wrote in', async ({ page }) => {
    await signIn(page)
    await page.goto('/p/cilek')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Çilek')
    await expect(page.getByRole('definition').filter({ hasText: 'No photos yet' })).toBeVisible()
    await expect(articles(page)).toHaveCount(1)
    await expect(articles(page).getByRole('heading')).toHaveText('Saturday, August 3, 2019')
  })

  test('is a timeline of only their memories, with month headings and tabs, newest first', async ({ page }) => {
    await signIn(page)
    await page.goto('/p/limon')

    await expect(articles(page).getByRole('heading')).toHaveText([
      'Saturday, January 20, 2024',
      'Thursday, January 18, 2024',
      'Sunday, January 14, 2024',
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

  test('puts the latest date on the day it was in the chat, whatever the zone of the chat or the reader', async ({ browser }) => {
    // A reader 14 hours ahead of UTC: a date worked out in their zone, or in UTC, would be wrong.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Pacific/Kiritimati' })
    const page = await context.newPage()
    await signIn(page)
    await page.goto('/p/karpuz')

    // 04:30 UTC on 21 January in New York is the 20th; 22:30 UTC on the 13th in Istanbul is the 14th.
    await expect(page.getByRole('definition').filter({ hasText: 'Saturday, January 20, 2024' })).toBeVisible()
    await expect(articles(page).getByRole('heading').nth(0)).toHaveText('Saturday, January 20, 2024')
    await expect(articles(page).getByRole('heading').nth(2)).toHaveText('Sunday, January 14, 2024')
    await context.close()
  })

  test('does not hold a memory where the person is only named in what someone wrote', async ({ page }) => {
    await signIn(page)
    await page.goto('/p/cilek')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Çilek')
    await expect(articles(page)).toHaveCount(1)
    await expect(articles(page).getByRole('heading')).toHaveText('Saturday, August 3, 2019')
    // The memory that names them is there for the person who wrote it.
    await page.goto('/p/limon')
    await expect(articles(page).filter({ hasText: 'January 18, 2024' })).toHaveCount(1)
  })

  test('has one main heading, the name, also when their memories could not be loaded', async ({ page }) => {
    await signIn(page)
    await page.route(/\/rpc\/timeline_page/, (route) => route.fulfill({ status: 500, json: { message: 'no' } }))
    await page.goto('/p/limon')

    await expect(page.getByRole('heading', { name: 'Could not load' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Limon')
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
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saturday, January 20, 2024')

    // A name is a target big enough to tap.
    const name = page.getByRole('region', { name: 'Conversation' }).getByRole('link', { name: 'Limon' }).first()
    expect((await name.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await name.click()
    await expect(page).toHaveURL(/\/p\/limon$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Limon')

    await page.goBack()
    await page.getByRole('figure').getByRole('link', { name: 'Karpuz' }).first().click()
    await expect(page).toHaveURL(/\/p\/karpuz$/)
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
    expect(people.map((p) => p.id)).toEqual(expect.arrayContaining(['cilek', 'fistik', 'incir', 'karpuz', 'limon']))
    for (const person of people) expect(Object.keys(person).sort()).toEqual(['id', 'name', 'photos'])
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

test.describe('an empty group', () => {
  test('says nothing is here yet, not that it could not load', async ({ page }) => {
    await signIn(page)
    await page.route(/\/rpc\/people_page/, (route) => route.fulfill({ json: [] }))
    await page.goto('/people')

    await expect(page.getByRole('heading', { name: 'Nobody here yet' })).toBeVisible()
    await expect(page.getByText('Could not load')).toHaveCount(0)
  })
})

test.describe('coming back to a person from a memory', () => {
  test('returns to the memory opened from their page, though Earlier and Later stepped onto others', async ({ page }) => {
    await signIn(page)
    await page.goto('/p/limon')
    const january = articles(page).filter({ hasText: 'January 22, 2023' })
    await january.scrollIntoViewIfNeeded()
    await january.getByRole('link').click()
    // The back link says where it goes: the person's page.
    await expect(page.getByRole('button', { name: 'Limon' })).toBeVisible()
    // Later steps onto the memories of 1 February 2023, which Limon is not in.
    await page.getByRole('link', { name: 'Later memory' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wednesday, February 1, 2023')
    await expect(page.getByRole('button', { name: 'Limon' })).toBeVisible()

    await page.getByRole('button', { name: 'Limon' }).click()

    await expect(page).toHaveURL(/\/p\/limon$/)
    await expect(january).toBeInViewport()
  })

  test('also by the browser\'s Back, and the main timeline keeps saying All memories', async ({ page }) => {
    await signIn(page)
    await page.goto('/p/limon')
    const january = articles(page).filter({ hasText: 'January 22, 2023' })
    await january.scrollIntoViewIfNeeded()
    await january.getByRole('link').click()
    await page.getByRole('link', { name: 'Later memory' }).click()

    await page.goBack()

    await expect(page).toHaveURL(/\/p\/limon$/)
    await expect(january).toBeInViewport()
    await page.goto('/')
    await articles(page).first().getByRole('link').click()
    await expect(page.getByRole('button', { name: 'All memories' })).toBeVisible()
  })
})

test.describe('how people look', () => {
  test('a name is marked as Turkish, a photo-less person has the name and one line, a photo person has photos', async ({ page }) => {
    await signIn(page)
    await page.goto('/people')
    const cards = page.getByRole('list', { name: 'People' }).getByRole('listitem')

    await expect(cards.filter({ hasText: 'İncir' }).locator('[lang="tr"]').getByRole('heading')).toHaveText('İncir')
    await expect(cards.filter({ hasText: 'İncir' }).getByText('No photos yet')).toBeVisible()
    await expect(cards.filter({ hasText: 'Limon' }).locator('img')).toHaveCount(4)
    await page.goto('/p/limon')
    await expect(page.locator('h1[lang="tr"]')).toHaveText('Limon')
  })

  test('people sit in one column on a phone and in more than one on a PC', async ({ page, browser }) => {
    await signIn(page)
    await page.goto('/people')
    const first = async (p: Page) => p.getByRole('list', { name: 'People' }).getByRole('listitem')
    const cards = await first(page)
    await expect(cards.nth(1)).toBeVisible()
    expect((await cards.nth(0).boundingBox())!.x).toBe((await cards.nth(1).boundingBox())!.x)

    const wide = await openWide(browser, addPerson(fruit('Karpuz')))
    await expect(articles(wide.page).first()).toBeVisible()
    await wide.page.goto('/people')
    const row = await first(wide.page)
    await expect(row.nth(1)).toBeVisible()
    const [a, b] = [(await row.nth(0).boundingBox())!, (await row.nth(1).boundingBox())!]
    expect(b.x).toBeGreaterThan(a.x + a.width - 1)
    expect(Math.abs(a.y - b.y)).toBeLessThan(2)
    await wide.context.close()
  })

  test('neither screen scrolls sideways at 390, 900, 1440 and 1920 px', async ({ browser }) => {
    for (const width of [390, 900, 1440, 1920]) {
      const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')), { width })
      await expect(articles(page).first()).toBeVisible()
      for (const path of ['/people', '/p/limon', '/p/nobody']) {
        await page.goto(path)
        await expect(page.getByRole('heading').first()).toBeVisible()
        await expectNoSidewaysScroll(page)
      }
      await context.close()
    }
  })

  test('in Turkish the labels are Turkish and the names stay as they are', async ({ browser }) => {
    const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')), { width: 390, locale: 'tr-TR' })
    await expect(articles(page).first()).toBeVisible()
    await page.goto('/people')
    await expect(page.getByRole('heading', { level: 1, name: 'Kişiler' })).toBeVisible()
    await expect(page.getByText('Henüz fotoğraf yok').first()).toBeVisible()
    await page.goto('/p/nobody')
    await expect(page.getByRole('heading', { name: 'Bu kişi burada yok' })).toBeVisible()
    await context.close()
  })

  test('a failed people page says so and tries again', async ({ page }) => {
    await signIn(page)
    let fail = true
    await page.route(/\/rpc\/people_page/, (route) => (fail ? route.fulfill({ status: 500, json: {} }) : route.continue()))
    await page.goto('/people')
    await expect(page.getByRole('heading', { name: 'Could not load' })).toBeVisible()
    fail = false
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('list', { name: 'People' })).toBeVisible()
  })
})
