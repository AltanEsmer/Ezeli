// The whole interface as one thing: every screen, the private page and the menu, at the four widths
// a friend's window can have, and with the device set to less motion.
import { type Page, expect, test } from '@playwright/test'
import { addPerson, expectNoSidewaysScroll, fruit, openWide } from './support.ts'

const memories = (page: Page) => page.getByRole('article')

// Visits the five screens (timeline, memory, people, a person, search), then the menu. Each screen
// is awaited until it shows its content, so a wrong width is measured on the real thing.
async function visitAll(page: Page, check: () => Promise<void>) {
  await expect(memories(page).first()).toBeVisible()
  await check()

  await memories(page).first().getByRole('link').first().click()
  await expect(page.getByRole('region', { name: 'Conversation' })).toBeVisible()
  await check()

  await page.goto('/people')
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible()
  await check()

  await page.getByRole('list', { name: 'People' }).getByRole('link').first().click()
  await expect(page.getByRole('definition').first()).toBeVisible()
  await check()

  await page.goto('/search')
  await expect(page.getByRole('search')).toBeVisible()
  await check()

  await page.getByRole('button', { name: /^Menu/ }).click()
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible()
  await check()
}

test('no screen, the private page or the menu scrolls sideways at 390, 900, 1440 and 1920 px', async ({ browser }) => {
  for (const width of [390, 900, 1440, 1920]) {
    const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')), { width })
    await visitAll(page, () => expectNoSidewaysScroll(page))
    await context.close()

    const signedOut = await browser.newContext({ viewport: { width, height: 900 } })
    const lone = await signedOut.newPage()
    await lone.goto('/')
    await expect(lone.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()
    await expectNoSidewaysScroll(lone)
    await signedOut.close()
  }
})

test('with the device set to less motion nothing animates on any screen or in the menu', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } })
  // Every new page of the visit starts its own list of what moved.
  await context.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { seen: string[] }).seen = seen
    for (const name of ['animationstart', 'transitionrun']) document.addEventListener(name, (event) => seen.push(`${name} ${(event.target as Element).tagName}`), true)
  })
  const page = await context.newPage()
  await page.goto(addPerson(fruit('Karpuz')))
  const nothingMoved = async () => {
    await page.waitForTimeout(250)
    expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen)).toEqual([])
  }
  await visitAll(page, nothingMoved)
  // Closing the menu does not fade either: it is gone at once.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden()
  await nothingMoved()
  await context.close()
})
