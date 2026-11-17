import { type Browser, expect, test } from '@playwright/test'
import { addPerson, addPersonWithoutAccount, apiUrl, fruit, ownerCommand, publishableKey } from './support.ts'

const linkIn = (text: string) => text.match(/https?:\/\/\S+/)![0]

async function newDevice(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' })
  return { context, page: await context.newPage() }
}

test.describe('replacing a friend’s link', () => {
  test('the new link signs the same person in, and the old link is refused on a fresh device', async ({ browser, page }) => {
    const name = fruit('Karpuz')
    const oldLink = addPerson(name)

    const result = ownerCommand(['person', 'relink', '--name', name])

    expect(result.status).toBe(0)
    const newLink = linkIn(result.stdout)
    expect(newLink).not.toBe(oldLink)
    const fresh = await newDevice(browser)
    await fresh.page.goto(oldLink)
    await expect(fresh.page.getByRole('heading', { name: 'This link does not work' })).toBeVisible()
    await fresh.context.close()
    await page.goto(newLink)
    await expect(page.getByText('No memories yet')).toBeVisible()
    await page.getByRole('button', { name: /^Menu/ }).click()
    await expect(page.getByRole('dialog', { name: 'Menu' }).getByText(name)).toBeVisible()
  })

  test('a device signed in with the old link shows the private page on its next load, and the new link brings it back', async ({ browser, page }) => {
    const name = fruit('Limon')
    await page.goto(addPerson(name))
    await expect(page.getByText('No memories yet')).toBeVisible()
    const other = await newDevice(browser)
    await other.page.goto(addPerson(fruit('Çilek')))
    await expect(other.page.getByText('No memories yet')).toBeVisible()

    const newLink = linkIn(ownerCommand(['person', 'relink', '--name', name]).stdout)

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()
    // Someone else's device is not touched.
    await other.page.reload()
    await expect(other.page.getByText('No memories yet')).toBeVisible()
    await other.context.close()
    await page.goto(newLink)
    await expect(page.getByText('No memories yet')).toBeVisible()
  })

  test('the old access token, used straight against the database after a relink, reads nothing', async ({ page, request }) => {
    const name = fruit('Çilek')
    await page.goto(addPerson(name))
    await expect(page.getByText('No memories yet')).toBeVisible()
    const token = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'))!
      return JSON.parse(localStorage.getItem(key)!).access_token as string
    })
    const headers = { apikey: publishableKey, authorization: `Bearer ${token}` }
    expect((await (await request.get(`${apiUrl}/rest/v1/people?select=id`, { headers })).json()).length).toBeGreaterThan(0)

    ownerCommand(['person', 'relink', '--name', name])

    expect(await (await request.get(`${apiUrl}/rest/v1/people?select=id`, { headers })).json()).toEqual([])
  })

  test('an owner is still an owner after a relink', async ({ page }) => {
    const name = fruit('Karpuz')
    addPerson(name, { owner: true })

    const link = linkIn(ownerCommand(['person', 'relink', '--name', name]).stdout)

    await page.goto(link)
    await expect(page.getByText('No memories yet')).toBeVisible()
    await page.getByRole('button', { name: /^Menu/ }).click()
    await expect(page.getByRole('dialog', { name: 'Menu' }).getByText('Owner', { exact: true })).toBeVisible()
    expect(ownerCommand(['person', 'list']).stdout.split('\n').find((l) => l.includes(name))).toMatch(/yes +yes +/)
  })

  test('a repeated --name is an error and changes nobody', async () => {
    const first = fruit('Limon')
    const second = fruit('Limon')
    addPerson(first)
    addPerson(second)

    const result = ownerCommand(['person', 'relink', '--name', first, '--name', second])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('--name only once')
    expect(result.stdout).not.toContain('#k=')
  })

  test('prints the database’s message when it refuses, not [object Object]', async () => {
    const result = ownerCommand(['person', 'relink', '--name', fruit('Karpuz')], { SUPABASE_SECRET_KEY: 'sb_secret_wrong' })

    expect(result.status).toBe(1)
    expect(result.stderr).not.toContain('[object Object]')
    expect(result.stderr.trim()).not.toBe('')
  })

  test('says so when the name is unknown, has no link yet, or is missing', async () => {
    const unknown = ownerCommand(['person', 'relink', '--name', fruit('Karpuz')])
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain('There is no person called')

    const name = fruit('Fıstık')
    await addPersonWithoutAccount(name)
    const noLink = ownerCommand(['person', 'relink', '--name', name])
    expect(noLink.status).toBe(1)
    expect(noLink.stderr).toContain('has no personal link yet')

    const missing = ownerCommand(['person', 'relink'])
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('person relink --name')
    for (const result of [unknown, noLink, missing]) expect(result.stdout).not.toContain('#k=')
  })
})

test.describe('listing people', () => {
  const rowOf = (listing: string, name: string) => listing.split('\n').find((line) => line.includes(name)) ?? ''

  test('shows who has a link, who is an owner, and who has opened theirs', async ({ page }) => {
    const opened = fruit('Karpuz')
    const waiting = fruit('Limon')
    const noLink = fruit('Fıstık')
    const boss = fruit('Çilek')
    const openedLink = addPerson(opened)
    addPerson(waiting)
    addPerson(boss, { owner: true })
    await addPersonWithoutAccount(noLink)
    await page.goto(openedLink)
    await expect(page.getByText('No memories yet')).toBeVisible()

    const result = ownerCommand(['person', 'list'])

    expect(result.status).toBe(0)
    expect(rowOf(result.stdout, opened)).toMatch(/yes +no +\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/)
    expect(rowOf(result.stdout, waiting)).toMatch(/yes +no +not yet$/)
    expect(rowOf(result.stdout, boss)).toMatch(/yes +yes +not yet$/)
    expect(rowOf(result.stdout, noLink)).toMatch(/no +no +-$/)
    expect(result.stdout).not.toMatch(/[0-9a-f]{32}/)
  })

  test('does not need the app address', async () => {
    const result = ownerCommand(['person', 'list'], { EZELI_APP_URL: '' })

    expect(result.status).toBe(0)
  })

  test('shows a replaced link as not opened until the new link is used', async ({ page }) => {
    const name = fruit('Karpuz')
    await page.goto(addPerson(name))
    await expect(page.getByText('No memories yet')).toBeVisible()
    const newLink = linkIn(ownerCommand(['person', 'relink', '--name', name]).stdout)

    expect(rowOf(ownerCommand(['person', 'list']).stdout, name)).toMatch(/not yet$/)

    await page.goto(newLink)
    await expect(page.getByText('No memories yet')).toBeVisible()
    expect(rowOf(ownerCommand(['person', 'list']).stdout, name)).toMatch(/\d{2}:\d{2} UTC$/)
  })
})
