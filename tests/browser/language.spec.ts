// The language switch, as a friend uses it, on the memories the real import saved (import.setup.ts).
import { type Browser, type Page, expect, test } from '@playwright/test'
import { type Language, labels } from '../../src/i18n.ts'
import { addPerson, apiUrl, fruit, ownerCommand, publishableKey, sentBy } from './support.ts'

const memories = (page: Page) => page.getByRole('article')
const names = { tr: 'Türkçe', en: 'English' }
const menuName = { tr: 'Menü', en: 'Menu' }

async function openMenu(page: Page, language: Language) {
  await page.getByRole('button', { name: new RegExp(`^${menuName[language]}`) }).click()
  return page.getByRole('dialog', { name: menuName[language] })
}

// Chooses a language in the menu and waits until the app has saved it.
async function choose(page: Page, from: Language, to: Language) {
  const menu = await openMenu(page, from)
  const saved = page.waitForResponse((response) => response.url().includes('/rpc/set_my_language'))
  await menu.getByRole('button', { name: names[to] }).click()
  expect((await saved).ok()).toBe(true)
}

async function device(browser: Browser, locale: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale })
  return { context, page: await context.newPage() }
}

// Every piece of fixed text of one language: labels, and the fixed parts around the names in
// sentences like "Sent by <names>". The names of the two languages themselves are not labels.
function fragments(language: Language): string[] {
  return Object.values(labels[language]).flatMap((label) => (typeof label === 'function' ? label('\u0000').split('\u0000') : [label])).filter(Boolean)
}

// What a friend can read or hear on the screen: its text, and the names of its buttons and pictures.
async function readable(page: Page): Promise<string> {
  return page.evaluate(() => {
    const attributes = [...document.querySelectorAll('[aria-label],[alt],[title]')].flatMap((el) =>
      ['aria-label', 'alt', 'title'].map((name) => el.getAttribute(name) ?? ''),
    )
    return [document.body.innerText, ...attributes].join('\n')
  })
}

// The screen shows its own language and none of the other: every label of the other language is absent.
async function expectOnly(page: Page, language: Language) {
  const other: Language = language === 'tr' ? 'en' : 'tr'
  const text = await readable(page)
  const own = new Set(fragments(language))
  for (const fragment of fragments(other)) {
    if (own.has(fragment) || fragment.length < 3) continue
    expect(text, `"${fragment}" is ${other} text on a ${language} screen`).not.toContain(fragment)
  }
  await expect(page.locator('html')).toHaveAttribute('lang', language)
}

for (const language of ['en', 'tr'] as const) {
  test.describe(`every screen, with the person's language ${language}`, () => {
    const browser: Language = language === 'tr' ? 'en' : 'tr' // the browser says the opposite
    const locale = browser === 'tr' ? 'tr-TR' : 'en-US'

    test('shows no label of the other language', async ({ browser: browserType }) => {
      const { context, page } = await device(browserType, locale)
      // An owner, so the owner stamp is on the menu that is walked.
      await page.goto(addPerson(fruit('Karpuz'), { owner: true }))
      await expect(memories(page).first()).toBeVisible()
      await choose(page, browser, language)
      await page.keyboard.press('Escape')

      // The timeline.
      await expect(sentBy(memories(page)).first()).toContainText(language === 'tr' ? 'gönderdi' : 'Sent by')
      await expectOnly(page, language)
      // The menu.
      const menu = await openMenu(page, language)
      await expect(menu.getByRole('button', { name: names[language] })).toHaveAttribute('aria-pressed', 'true')
      await expect(menu.getByText(labels[language].owner, { exact: true })).toBeVisible()
      await expect(menu.getByText(labels[language].language, { exact: true })).toBeVisible()
      await expectOnly(page, language)
      await page.keyboard.press('Escape')
      // The search screen: before a search, with results, with nothing found, while it fails.
      await page.getByRole('link', { name: labels[language].search, exact: true }).click()
      const box = page.getByRole('searchbox', { name: labels[language].searchLabel })
      await expect(page.getByText(labels[language].searchHint)).toBeVisible()
      await expectOnly(page, language)
      await box.fill('güzel')
      await box.press('Enter')
      await expect(memories(page).first()).toBeVisible()
      await expect(sentBy(memories(page)).first()).toContainText(language === 'tr' ? 'gönderdi' : 'Sent by')
      await expectOnly(page, language)
      await box.fill('zzzyyy')
      await box.press('Enter')
      await expect(page.getByRole('heading', { name: labels[language].nothingFound })).toBeVisible()
      await expectOnly(page, language)
      await page.route(/\/rest\/v1\/rpc\/search_memories/, (route) => route.fulfill({ status: 400, json: { message: 'no' } }))
      await box.fill('güzel')
      await box.press('Enter')
      await expect(page.getByRole('heading', { name: labels[language].failedTitle })).toBeVisible()
      await expectOnly(page, language)
      await page.unroute(/\/rest\/v1\/rpc\/search_memories/)
      await page.goto('/')
      await expect(memories(page).first()).toBeVisible()
      // The people page, a person's page and one that is not there.
      await page.getByRole('link', { name: labels[language].people }).click()
      await expect(page.getByRole('list', { name: labels[language].people })).toBeVisible()
      await expectOnly(page, language)
      await page.getByRole('link', { name: /Limon/ }).click()
      await expect(page.getByText(labels[language].firstMemory, { exact: true })).toBeVisible()
      await expect(memories(page).first()).toBeVisible()
      await expectOnly(page, language)
      await page.goto('/p/nobody')
      await expect(page.getByRole('heading', { name: labels[language].personMissingTitle })).toBeVisible()
      await expectOnly(page, language)
      // The people page when it cannot load.
      await page.route(/\/rpc\/people_page/, (route) => route.fulfill({ status: 400, json: { message: 'no' } }))
      await page.goto('/people')
      await expect(page.getByRole('heading', { name: labels[language].failedTitle })).toBeVisible()
      await expectOnly(page, language)
      await page.unroute(/\/rpc\/people_page/)
      await page.route(/\/rpc\/people_page/, (route) => route.fulfill({ json: [] }))
      await page.goto('/people')
      await expect(page.getByRole('heading', { name: labels[language].noPeople })).toBeVisible()
      await expectOnly(page, language)
      await page.unroute(/\/rpc\/people_page/)
      await page.goto('/')
      await expect(memories(page).first()).toBeVisible()
      // The timeline when it cannot load, and when it is empty.
      // (A network failure would be retried by the client for several seconds; a refusal is not.)
      await page.route(/\/rest\/v1\/(rpc\/)?timeline/, (route) => route.fulfill({ status: 400, json: { message: 'no' } }))
      await page.reload()
      await expect(page.getByRole('heading', { name: labels[language].failedTitle })).toBeVisible()
      await expectOnly(page, language)
      await page.unroute(/\/rest\/v1\/(rpc\/)?timeline/)
      await page.route(/\/rest\/v1\/(rpc\/)?timeline/, (route) => route.fulfill({ json: [] }))
      await page.reload()
      await expect(page.getByText(labels[language].emptyTitle)).toBeVisible()
      await expectOnly(page, language)
      await page.unroute(/\/rest\/v1\/(rpc\/)?timeline/)
      // Sign-in failing, still in the person's language? Not known yet: the private pages follow the browser.
      await context.close()
    })
  })

  test.describe(`the pages before sign-in, with the browser set to ${language}`, () => {
    test.use({ locale: language === 'tr' ? 'tr-TR' : 'en-US' })

    test('show no label of the other language', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('heading', { name: labels[language].privateTitle })).toBeVisible()
      await expectOnly(page, language)

      await page.goto(`/#k=${'0'.repeat(16)}.${'0'.repeat(64)}`)
      await expect(page.getByRole('heading', { name: labels[language].badLinkTitle })).toBeVisible()
      await expectOnly(page, language)

      await page.route('**/auth/v1/token*', (route) => route.abort('connectionfailed'))
      await page.goto(addPerson(fruit('Limon')))
      await expect(page.getByRole('heading', { name: labels[language].failedTitle })).toBeVisible()
      await expectOnly(page, language)
    })
  })
}

test.describe('switching', () => {
  test('changes every label and every date at once, with no reload', async ({ page }) => {
    await page.goto(addPerson(fruit('Çilek')))
    await expect(memories(page).first()).toBeVisible()
    await expect(memories(page).getByRole('heading')).toHaveText(['Saturday, July 15, 2023', 'Friday, July 14, 2023', 'Sunday, March 5, 2023', 'Sunday, January 22, 2023'])
    await page.evaluate(() => ((window as unknown as { stillHere: boolean }).stillHere = true))
    const menu = await openMenu(page, 'en')
    // Until the person chooses, the circled one is the browser's.
    await expect(menu.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
    await expect(menu.getByRole('button', { name: 'Türkçe' })).toHaveAttribute('aria-pressed', 'false')

    await menu.getByRole('button', { name: 'Türkçe' }).click()

    await expect(page.getByRole('dialog', { name: 'Menü' }).getByRole('button', { name: 'Bu cihazdan çık' })).toBeVisible()
    await expectOnly(page, 'tr')
    await expect(memories(page).getByRole('heading')).toHaveText(['15 Temmuz 2023 Cumartesi', '14 Temmuz 2023 Cuma', '5 Mart 2023 Pazar', '22 Ocak 2023 Pazar'])
    await expect(sentBy(memories(page)).first()).toHaveText('Fıstık gönderdi')
    expect(await page.evaluate(() => (window as unknown as { stillHere?: boolean }).stillHere)).toBe(true)

    await page.getByRole('dialog', { name: 'Menü' }).getByRole('button', { name: 'English' }).click()

    await expect(memories(page).getByRole('heading')).toHaveText(['Saturday, July 15, 2023', 'Friday, July 14, 2023', 'Sunday, March 5, 2023', 'Sunday, January 22, 2023'])
    await expectOnly(page, 'en')
  })

  test('is remembered for the person, also on another device, and beats the browser', async ({ browser }) => {
    const link = addPerson(fruit('Fıstık'))
    const first = await device(browser, 'en-US')
    await first.page.goto(link)
    await choose(first.page, 'en', 'tr')
    await expect(first.page.getByRole('dialog', { name: 'Menü' })).toBeVisible()

    const second = await device(browser, 'en-US')
    await second.page.goto(link)

    await expect(memories(second.page).getByRole('heading').first()).toHaveText('15 Temmuz 2023 Cumartesi')
    await expectOnly(second.page, 'tr')
    await first.page.reload()
    await expect(memories(first.page).getByRole('heading').first()).toHaveText('15 Temmuz 2023 Cumartesi')
    await first.context.close()
    await second.context.close()
  })

  test('follows the browser for a person who has not chosen, and another person is not affected', async ({ browser }) => {
    const chooser = await device(browser, 'en-US')
    await chooser.page.goto(addPerson(fruit('Karpuz')))
    await choose(chooser.page, 'en', 'tr')
    await expect(chooser.page.getByRole('dialog', { name: 'Menü' })).toBeVisible()

    const other = await device(browser, 'tr-TR')
    await other.page.goto(addPerson(fruit('Limon')))

    await expect(memories(other.page).getByRole('heading').first()).toHaveText('15 Temmuz 2023 Cumartesi')
    await chooser.context.close()
    await other.context.close()
  })

  test('a person signing out is shown the private page in the browser’s language again', async ({ browser }) => {
    const { context, page } = await device(browser, 'en-US')
    await page.goto(addPerson(fruit('Limon')))
    await choose(page, 'en', 'tr')

    await page.getByRole('dialog', { name: 'Menü' }).getByRole('button', { name: 'Bu cihazdan çık' }).click()

    await expect(page.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()
    await context.close()
  })
})

test.describe('saving the choice', () => {
  test('two quick taps end with the last tapped language, on the screen and on the next load', async ({ browser }) => {
    const { context, page } = await device(browser, 'en-US')
    const link = addPerson(fruit('Limon'))
    await page.goto(link)
    await expect(memories(page).first()).toBeVisible()
    // The first save is slow: it would reach the server last.
    let calls = 0
    await page.route(/\/rpc\/set_my_language/, async (route) => {
      if (++calls === 1) await new Promise((done) => setTimeout(done, 1500))
      await route.continue()
    })
    const menu = await openMenu(page, 'en')

    await menu.getByRole('button', { name: 'Türkçe' }).click()
    await page.getByRole('dialog', { name: 'Menü' }).getByRole('button', { name: 'English' }).click()

    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible()
    await expect.poll(() => calls).toBe(2)
    await page.waitForTimeout(2000)
    await expectOnly(page, 'en')
    await page.unroute(/\/rpc\/set_my_language/)
    await page.reload()
    await expect(page.getByRole('button', { name: /^Menu/ })).toBeVisible()
    await expectOnly(page, 'en')
    const other = await device(browser, 'tr-TR')
    await other.page.goto(link)
    // A Turkish browser, but the stored choice is the last tap: English.
    await expect(other.page.getByRole('button', { name: /^Menu/ })).toBeVisible()
    await expectOnly(other.page, 'en')
    await context.close()
    await other.context.close()
  })

  test('tells the friend in one line, in the current language, when it cannot be saved', async ({ browser }) => {
    const { context, page } = await device(browser, 'en-US')
    await page.goto(addPerson(fruit('Limon')))
    await expect(memories(page).first()).toBeVisible()
    await page.route(/\/rpc\/set_my_language/, (route) => route.fulfill({ status: 400, json: { message: 'no' } }))

    await (await openMenu(page, 'en')).getByRole('button', { name: 'Türkçe' }).click()

    const dialog = page.getByRole('dialog', { name: 'Menu' })
    await expect(dialog.getByRole('alert')).toHaveText(labels.en.saveFailed)
    await expect(dialog.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
    await expectOnly(page, 'en')
    await context.close()
  })
})

test.describe('what the app may write about a person', () => {
  async function signedIn(browser: Browser) {
    const { context, page } = await device(browser, 'en-US')
    const name = fruit('Karpuz')
    await page.goto(addPerson(name))
    await expect(memories(page).first()).toBeVisible()
    const token = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'))!
      return JSON.parse(localStorage.getItem(key)!).access_token as string
    })
    return { context, name, headers: { apikey: publishableKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' } }
  }

  test('is the language of the caller, and nothing else', async ({ browser, request }) => {
    const { context, headers } = await signedIn(browser)
    const bystander = await signedIn(browser)
    const me = async (h: typeof headers) => (await (await request.post(`${apiUrl}/rest/v1/rpc/current_person`, { headers: h })).json())[0]
    const before = await me(headers)
    expect(before.language).toBeNull()

    // It works for the caller...
    expect((await request.post(`${apiUrl}/rest/v1/rpc/set_my_language`, { headers, data: { chosen: 'tr' } })).ok()).toBe(true)
    expect(await me(headers)).toEqual({ ...before, language: 'tr' })
    // ...and no one else is touched, and nothing else can be written.
    expect((await me(bystander.headers)).language).toBeNull()
    for (const patch of [{ language: 'en' }, { is_owner: true }, { display_name: 'Armut' }]) {
      const answer = await request.patch(`${apiUrl}/rest/v1/people?id=not.is.null`, { headers, data: patch })
      expect(answer.ok(), JSON.stringify(patch)).toBe(false)
    }
    expect((await request.post(`${apiUrl}/rest/v1/people`, { headers, data: { display_name: 'Armut' } })).ok()).toBe(false)
    expect((await request.post(`${apiUrl}/rest/v1/rpc/set_my_language`, { headers, data: { chosen: 'de' } })).ok()).toBe(false)
    expect(await me(headers)).toEqual({ ...before, language: 'tr' })
    expect((await me(bystander.headers)).language).toBeNull()
    await context.close()
    await bystander.context.close()
  })

  test('reports failure with no valid session, refuses wrong values plainly, and does not offer clearing', async ({ browser, request }) => {
    const { context, name, headers } = await signedIn(browser)
    const call = (chosen: unknown) => request.post(`${apiUrl}/rest/v1/rpc/set_my_language`, { headers, data: { chosen } })

    for (const wrong of ['de', null]) {
      const answer = await call(wrong)
      expect(answer.ok(), String(wrong)).toBe(false)
      const text = await answer.text()
      expect(text).toContain('unknown language')
      expect(text).not.toContain(name)
      expect(text).not.toContain('user_id')
    }
    // The link is replaced: the old token is still inside its lifetime but the session is gone.
    const replaced = ownerCommand(['person', 'relink', '--name', name])
    expect(replaced.status).toBe(0)
    const refused = await call('en')
    expect(refused.ok()).toBe(false)
    expect(await refused.text()).toContain('not signed in')
    await context.close()
  })

  test('is refused to a visitor', async ({ request }) => {
    const visitor = { apikey: publishableKey, 'content-type': 'application/json' }
    expect((await request.post(`${apiUrl}/rest/v1/rpc/set_my_language`, { headers: visitor, data: { chosen: 'tr' } })).ok()).toBe(false)
  })
})
