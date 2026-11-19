// The look's ground: the bar, the menu, the small pages, language marks, motion, and the two sizes.
// Phone size is the default of the setup; a wide window comes from openWide (support.ts).
import { type Page, expect, test } from '@playwright/test'
import { addPerson, expectNoSidewaysScroll, fruit, openWide } from './support.ts'

const bar = (page: Page) => page.getByRole('navigation', { name: /^(Pages|Sayfalar)$/ })
const memories = (page: Page) => page.getByRole('article')
const path = (page: Page) => page.evaluate(() => location.pathname)

async function signedIn(page: Page, name = fruit('Karpuz'), options: { owner?: boolean } = {}) {
  await page.goto(addPerson(name, options))
  await expect(memories(page).first()).toBeVisible()
  return name
}

test.describe('on a phone', () => {
  test('the top bar holds Ezeli, People, Search and the menu button, and Ezeli leads to the timeline', async ({ page }) => {
    await signedIn(page)

    await expect(bar(page).getByRole('link', { name: 'Ezeli' })).toBeVisible()
    await expect(bar(page).getByRole('link', { name: 'People' })).toBeVisible()
    await expect(bar(page).getByRole('link', { name: 'Search' })).toBeVisible()
    await expect(bar(page).getByRole('button', { name: /^Menu/ })).toBeVisible()
    await expect(bar(page).getByRole('link', { name: 'Memories' })).toBeHidden()

    await bar(page).getByRole('link', { name: 'People' }).click()
    await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible()
    await bar(page).getByRole('link', { name: 'Ezeli' }).click()
    await expect(memories(page).first()).toBeVisible()
    expect(await path(page)).toBe('/')
  })

  test('the bar leads to people and search from the person screen and marks the place', async ({ page }) => {
    await signedIn(page)
    await bar(page).getByRole('link', { name: 'People' }).click()
    await expect(bar(page).getByRole('link', { name: 'People' })).toHaveAttribute('aria-current', 'page')
    await expect(bar(page).getByRole('link', { name: 'Search' })).not.toHaveAttribute('aria-current', 'page')

    await page.locator('a[href^="/p/"]').first().click()
    expect(await path(page)).toMatch(/^\/p\//)
    await expect(bar(page).getByRole('link', { name: 'People' })).toHaveAttribute('aria-current', 'page')

    await bar(page).getByRole('link', { name: 'Search' }).click()
    expect(await path(page)).toBe('/search')
    await expect(bar(page).getByRole('link', { name: 'Search' })).toHaveAttribute('aria-current', 'page')
    await expect(bar(page).getByRole('link', { name: 'People' })).not.toHaveAttribute('aria-current', 'page')
  })

  test('a memory has only its back link', async ({ page }) => {
    await signedIn(page)
    await memories(page).first().getByRole('link').first().click()

    await expect(page.getByRole('button', { name: /All memories/ })).toBeVisible()
    await expect(bar(page)).toBeHidden()
    await expectNoSidewaysScroll(page)
  })

  test('the menu holds the name, the owner mark, the language switch and sign-out; Tab stays inside it and Escape closes it', async ({ page }) => {
    const name = await signedIn(page, fruit('İncir'), { owner: true })
    await page.getByRole('button', { name: /^Menu/ }).click()
    const menu = page.getByRole('dialog', { name: 'Menu' })

    await expect(menu.getByText(name)).toBeVisible()
    await expect(menu.getByText('Owner', { exact: true })).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Türkçe' })).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Sign out on this device' })).toBeVisible()
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab')
      expect(await menu.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(page.getByRole('button', { name: /^Menu/ })).toBeFocused()
  })

  test('the private page, the bad-link page and the failed page are a name, a heading and a short paragraph', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()
    await expect(page.getByText('Ezeli', { exact: true })).toBeVisible()
    await expect(page.getByRole('button')).toHaveCount(0)
    await expect(bar(page)).toHaveCount(0)
    await expectNoSidewaysScroll(page)

    await page.goto(`/#k=${'0'.repeat(16)}.${'0'.repeat(64)}`)
    await expect(page.getByRole('heading', { name: 'This link does not work' })).toBeVisible()
    await expect(page.getByRole('button')).toHaveCount(0)

    await page.route('**/auth/v1/token*', (route) => route.abort('connectionfailed'))
    await page.goto(addPerson(fruit('Limon')))
    await expect(page.getByRole('heading', { name: 'Could not load' })).toBeVisible()
    await expect(page.getByRole('button')).toHaveCount(1)
  })

  test('a loading screen shows nothing', async ({ page }) => {
    await page.route('**/auth/v1/token*', () => {})
    await page.goto(addPerson(fruit('Limon')))

    await expect(page.getByRole('main', { name: 'Loading' })).toBeAttached()
    await expect(page.locator('body')).toHaveText('')
  })

  test('the page carries the language of the labels, and a name is marked as Turkish', async ({ browser }) => {
    for (const [locale, lang, menu] of [['tr-TR', 'tr', 'Menü'], ['en-US', 'en', 'Menu']] as const) {
      const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } })
      const page = await context.newPage()
      const name = fruit('Çilek')
      await page.goto(addPerson(name))
      await expect(memories(page).first()).toBeVisible()

      await expect(page.locator('html')).toHaveAttribute('lang', lang)
      await page.getByRole('button', { name: new RegExp(`^${menu}`) }).click()
      await expect(page.getByRole('dialog').getByText(name)).toHaveAttribute('lang', 'tr')
      await context.close()
    }
  })

  test('a screen change is a fade of at most 200 ms, and with less motion there is none', async ({ browser }) => {
    const watch = async (reducedMotion: 'reduce' | 'no-preference') => {
      const context = await browser.newContext({ reducedMotion, viewport: { width: 390, height: 844 } })
      const page = await context.newPage()
      await signedIn(page)
      await page.evaluate(() => {
        const seen: number[] = []
        ;(window as unknown as { seen: number[] }).seen = seen
        document.addEventListener('animationstart', (event) => seen.push(parseFloat(getComputedStyle(event.target as Element).animationDuration) * 1000), true)
      })
      await bar(page).getByRole('link', { name: 'Search' }).click()
      await expect(page.getByRole('search')).toBeVisible()
      await page.waitForTimeout(400)
      const seen = await page.evaluate(() => (window as unknown as { seen: number[] }).seen)
      await context.close()
      return seen
    }

    const fades = await watch('no-preference')
    expect(fades.length).toBeGreaterThan(0)
    expect(Math.max(...fades)).toBeLessThanOrEqual(200)
    expect(await watch('reduce')).toEqual([])
  })

  test('every control shows when it has the keyboard focus', async ({ page }) => {
    await signedIn(page)
    await page.keyboard.press('Tab')

    const outline = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement!)
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }
    })
    expect(outline.style).not.toBe('none')
    expect(outline.width).toBeGreaterThan(0)
  })

  test('the timeline has a different background when the device is dark and when it is light', async ({ browser }) => {
    const link = addPerson(fruit('Karpuz'))
    const backgrounds: string[] = []
    for (const colorScheme of ['dark', 'light'] as const) {
      const context = await browser.newContext({ colorScheme, viewport: { width: 390, height: 844 } })
      const page = await context.newPage()
      await page.goto(link)
      await expect(memories(page).first()).toBeVisible()
      backgrounds.push(await page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      await context.close()
    }

    expect(backgrounds[0]).not.toBe(backgrounds[1])
  })

  test('the screens do not scroll sideways', async ({ page }) => {
    await signedIn(page)
    for (const where of ['/', '/people', '/search']) {
      await page.goto(where)
      await expect(bar(page)).toBeVisible()
      await page.waitForTimeout(300)
      await expectNoSidewaysScroll(page)
    }
  })
})

test.describe('in a wide window', () => {
  test('the bar on the left leads to memories, people and search, and marks the current place', async ({ browser }) => {
    const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')))
    await expect(memories(page).first()).toBeVisible()

    const box = (await bar(page).boundingBox())!
    expect(box.x).toBe(0)
    expect(box.width).toBeLessThan(300)
    await expect(bar(page).getByRole('link', { name: 'Memories' })).toHaveAttribute('aria-current', 'page')
    await bar(page).getByRole('link', { name: 'People' }).click()
    expect(await path(page)).toBe('/people')
    await expect(bar(page).getByRole('link', { name: 'People' })).toHaveAttribute('aria-current', 'page')
    await expect(bar(page).getByRole('link', { name: 'Memories' })).not.toHaveAttribute('aria-current', 'page')
    await bar(page).getByRole('link', { name: 'Search' }).click()
    expect(await path(page)).toBe('/search')
    await expect(bar(page).getByRole('link', { name: 'Search' })).toHaveAttribute('aria-current', 'page')
    await bar(page).getByRole('link', { name: 'Memories' }).click()
    await expect(memories(page).first()).toBeVisible()
    expect(await path(page)).toBe('/')
    await context.close()
  })

  test('the name at the bottom opens the menu, and the bar stays on a memory', async ({ browser }) => {
    const name = fruit('Limon')
    const { context, page } = await openWide(browser, addPerson(name))
    await expect(memories(page).first()).toBeVisible()

    const me = bar(page).getByRole('button', { name: /^Menu/ })
    await expect(me).toContainText(name)
    const where = (await me.boundingBox())!
    expect(where.y).toBeGreaterThan(450)
    await me.click()
    await expect(page.getByRole('dialog', { name: 'Menu' }).getByText(name)).toBeVisible()
    await page.keyboard.press('Escape')

    await memories(page).first().getByRole('link').first().click()
    await expect(page.getByRole('button', { name: /All memories/ })).toBeVisible()
    await expect(bar(page).getByRole('link', { name: 'Search' })).toBeVisible()
    await context.close()
  })

  test('the labels of the bar are Turkish when the device is', async ({ browser }) => {
    const { context, page } = await openWide(browser, addPerson(fruit('Çilek')), { locale: 'tr-TR' })
    await expect(bar(page).getByRole('link', { name: 'Anılar' })).toBeVisible()
    await expect(bar(page).getByRole('link', { name: 'Kişiler' })).toBeVisible()
    await expect(bar(page).getByRole('link', { name: 'Ara' })).toBeVisible()
    await context.close()
  })

  for (const width of [900, 1440, 1920]) {
    test(`no screen scrolls sideways at ${width} px`, async ({ browser }) => {
      const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')), { width })
      await expect(memories(page).first()).toBeVisible()
      for (const where of ['/', '/people', '/search']) {
        await page.goto(where)
        await expect(bar(page)).toBeVisible()
        await page.waitForTimeout(300)
        await expectNoSidewaysScroll(page)
      }
      await context.close()
    })
  }

  test('one pixel under 900 px the bar is at the top', async ({ browser }) => {
    const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')), { width: 899 })
    await expect(memories(page).first()).toBeVisible()
    expect((await bar(page).boundingBox())!.y).toBe(0)
    expect((await bar(page).boundingBox())!.width).toBeGreaterThan(800)
    await context.close()
  })
})
