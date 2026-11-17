import { type Browser, type Page, type Route, expect, test } from '@playwright/test'
import { addPerson, addPersonWithoutAccount, apiUrl, fruit, ownerCommand, publishableKey } from './support.ts'

const hash = (page: Page) => page.evaluate(() => location.hash)

async function openMenu(page: Page) {
  await page.getByRole('button', { name: /^Menu/ }).click()
  return page.getByRole('dialog', { name: 'Menu' })
}

// A second device is a second browser context: its own storage, the same link.
async function newDevice(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' })
  return { context, page: await context.newPage() }
}

test.describe('a visitor without a link', () => {
  test('sees only the private page', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()
    await expect(page.getByText('Ask an owner for your personal link.')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Menu/ })).toHaveCount(0)
  })

  test('can read nothing from the database', async ({ request }) => {
    const people = await request.get(`${apiUrl}/rest/v1/people?select=id,display_name`, {
      headers: { apikey: publishableKey },
    })

    expect(people.ok()).toBe(false)
  })

  test('cannot make an account for themselves', async ({ request }) => {
    const signUp = await request.post(`${apiUrl}/auth/v1/signup`, {
      headers: { apikey: publishableKey },
      data: { email: 'nobody@example.com', password: 'a-long-password-nobody-will-ever-use-1' },
    })

    expect(signUp.ok()).toBe(false)
    expect((await signUp.json()).error_code).toBe('signup_disabled')
  })

  test('is told a broken link does not work, and the address bar is cleaned', async ({ page }) => {
    await page.goto(`/#k=${'0'.repeat(16)}.${'0'.repeat(64)}`)

    await expect(page.getByRole('heading', { name: 'This link does not work' })).toBeVisible()
    expect(await hash(page)).toBe('')
  })

  test('pages are kept out of search engines and previews show only the name', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Ezeli')
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(0)
    await expect(page.locator('meta[property="og:description"]')).toHaveCount(0)
  })
})

test.describe('a friend with a personal link', () => {
  test('is signed in as themselves on the empty timeline, with the secret gone from the address bar', async ({ page }) => {
    const name = fruit('Karpuz')
    const link = addPerson(name)

    await page.goto(link)

    await expect(page.getByRole('heading', { name: 'Ezeli is private' })).toHaveCount(0)
    await expect(page.getByText('No memories yet')).toBeVisible()
    const menu = await openMenu(page)
    await expect(menu.getByText(name)).toBeVisible()
    expect(await hash(page)).toBe('')
    expect(page.url()).not.toContain('#')
  })

  test('is still signed in when the browser is closed and opened again', async ({ browser, page }) => {
    const name = fruit('Limon')
    await page.goto(addPerson(name))
    await expect(page.getByText('No memories yet')).toBeVisible()
    const stored = await page.context().storageState()

    const reopened = await browser.newContext({ storageState: stored, viewport: { width: 390, height: 844 } })
    const again = await reopened.newPage()
    await again.goto('/')

    await expect(again.getByText('No memories yet')).toBeVisible()
    await expect((await openMenu(again)).getByText(name)).toBeVisible()
    await reopened.close()
  })

  test('can use the same link on a second device', async ({ browser, page }) => {
    const name = fruit('Çilek')
    const link = addPerson(name)
    await page.goto(link)
    await expect(page.getByText('No memories yet')).toBeVisible()

    const second = await newDevice(browser)
    await second.page.goto(link)

    await expect(second.page.getByText('No memories yet')).toBeVisible()
    await expect((await openMenu(second.page)).getByText(name)).toBeVisible()
    await second.context.close()
  })

  test('signs out on one device only, and the old session reads nothing afterwards', async ({ browser, page, request }) => {
    const link = addPerson(fruit('Fıstık'))
    await page.goto(link)
    await expect(page.getByText('No memories yet')).toBeVisible()
    const other = await newDevice(browser)
    await other.page.goto(link)
    await expect(other.page.getByText('No memories yet')).toBeVisible()
    const token = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'))!
      return JSON.parse(localStorage.getItem(key)!).access_token as string
    })

    await (await openMenu(page)).getByRole('button', { name: 'Sign out on this device' }).click()

    await expect(page.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()
    await other.page.reload()
    await expect(other.page.getByText('No memories yet')).toBeVisible()
    // The access token of the ended session is still inside its lifetime, but opens nothing.
    const people = await request.get(`${apiUrl}/rest/v1/people?select=id,display_name`, {
      headers: { apikey: publishableKey, authorization: `Bearer ${token}` },
    })
    expect(await people.json()).toEqual([])
    await other.context.close()
  })

  test('is signed in when the link is opened in a tab where the app is already open', async ({ page }) => {
    const name = fruit('Karpuz')
    const link = addPerson(name)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()

    await page.goto(link)

    await expect(page.getByText('No memories yet')).toBeVisible()
    expect(await hash(page)).toBe('')
  })

  test('stays signed in when a broken link is opened afterwards', async ({ page }) => {
    await page.goto(addPerson(fruit('Limon')))
    await expect(page.getByText('No memories yet')).toBeVisible()

    await page.goto('/#k=half-a-link')

    await expect(page.getByText('No memories yet')).toBeVisible()
    expect(await hash(page)).toBe('')
  })

  test('sees whether they are an owner in the menu', async ({ browser, page }) => {
    await page.goto(addPerson(fruit('Karpuz'), { owner: true }))
    await expect(page.getByText('No memories yet')).toBeVisible()
    await expect((await openMenu(page)).getByText('Owner', { exact: true })).toBeVisible()

    const friend = await newDevice(browser)
    await friend.page.goto(addPerson(fruit('Limon')))
    await expect(friend.page.getByText('No memories yet')).toBeVisible()
    await expect((await openMenu(friend.page)).getByText('Owner', { exact: true })).toHaveCount(0)
    await friend.context.close()
  })
})

test.describe('when sign-in cannot be answered', () => {
  for (const [what, failure] of [
    ['the network is down', (route: Route) => route.abort('connectionfailed')],
    ['Auth rate limits the address', (route: Route) => route.fulfill({ status: 429, json: { code: 429, error_code: 'over_request_rate_limit', msg: 'slow down' } })],
  ] as const) {
    test(`does not call the link dead when ${what}, and trying again works with the same link`, async ({ page }) => {
      const name = fruit('Karpuz')
      const link = addPerson(name)
      await page.route('**/auth/v1/token*', failure)

      await page.goto(link)

      await expect(page.getByRole('heading', { name: 'Could not load' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'This link does not work' })).toHaveCount(0)
      expect(await hash(page)).toBe('')
      await page.unroute('**/auth/v1/token*')
      await page.getByRole('button', { name: 'Try again' }).click()
      await expect(page.getByText('No memories yet')).toBeVisible()
      await expect((await openMenu(page)).getByText(name)).toBeVisible()
    })
  }

  test('says so in Turkish too', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'tr-TR', viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.route('**/auth/v1/token*', (route) => route.abort('connectionfailed'))

    await page.goto(addPerson(fruit('Çilek')))

    await expect(page.getByRole('heading', { name: 'Yüklenemedi' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tekrar dene' })).toBeVisible()
    await context.close()
  })
})

test('another person’s link on a signed-in device signs in as the new person', async ({ page }) => {
  const first = fruit('Limon')
  const second = fruit('Çilek')
  const firstLink = addPerson(first)
  const secondLink = addPerson(second)
  await page.goto(firstLink)
  await expect(page.getByText('No memories yet')).toBeVisible()

  await page.goto(secondLink)

  await expect(page.getByText('No memories yet')).toBeVisible()
  const menu = await openMenu(page)
  await expect(menu.getByText(second)).toBeVisible()
  await expect(menu.getByText(first)).toHaveCount(0)
})

test.describe('the menu', () => {
  test('keeps keyboard focus inside while it is open, and gives it back when closed', async ({ page }) => {
    await page.goto(addPerson(fruit('Karpuz')))
    await expect(page.getByText('No memories yet')).toBeVisible()
    const menu = await openMenu(page)

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      expect(await menu.evaluate((card) => card.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Shift+Tab')
    expect(await menu.evaluate((card) => card.contains(document.activeElement))).toBe(true)

    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: /^Menu/ })).toBeFocused()
  })
})

test.describe('language', () => {
  test.describe('browser set to Turkish', () => {
    test.use({ locale: 'tr-TR' })

    test('starts in Turkish', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Ezeli özel' })).toBeVisible()

      await page.goto(addPerson(fruit('Çilek')))

      await expect(page.getByText('Henüz anı yok')).toBeVisible()
      const menu = await page.getByRole('button', { name: /^Menü/ }).click().then(() => page.getByRole('dialog', { name: 'Menü' }))
      await expect(menu.getByRole('button', { name: 'Bu cihazdan çık' })).toBeVisible()
    })
  })

  test('starts in English when the browser is set to anything else', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })
})

test.describe('the owner command', () => {
  test('refuses a second person with the same display name', async () => {
    const name = fruit('Fıstık')
    addPerson(name)

    const again = ownerCommand(['person', 'add', '--name', name])

    expect(again.status).toBe(1)
    expect(again.stderr).toContain('already has a personal link')
    expect(again.stdout).not.toContain('#k=')
  })

  test('asks for a name', async () => {
    const result = ownerCommand(['person', 'add'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Usage: pnpm ezeli person add --name')
  })

  test('prints a different link each time, for the right app address', async () => {
    const first = addPerson(fruit('Karpuz'))
    const second = addPerson(fruit('Karpuz'))

    expect(first).not.toBe(second)
    expect(first).toMatch(/\/#k=[0-9a-f]{16}\.[0-9a-f]{64}$/)
  })
})

test.describe('a person the import made, who has no link yet', () => {
  test('gets an account and a link from person add, which signs them in', async ({ page }) => {
    const name = fruit('Fıstık')
    await addPersonWithoutAccount(name)

    const result = ownerCommand(['person', 'add', '--name', name])

    expect(result.status).toBe(0)
    await page.goto(result.stdout.match(/https?:\/\/\S+/)![0])
    await expect(page.getByText('No memories yet')).toBeVisible()
    await expect((await openMenu(page)).getByText(name)).toBeVisible()
  })

  test('is not given a second account once they have one', async () => {
    const name = fruit('Fıstık')
    await addPersonWithoutAccount(name)
    ownerCommand(['person', 'add', '--name', name])

    const again = ownerCommand(['person', 'add', '--name', name])

    expect(again.status).toBe(1)
    expect(again.stderr).toContain('Replacing a link')
  })
})
