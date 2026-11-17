// Comments, as friends use them on a phone, against the local Supabase. The memory is one the real
// import saved (import.setup.ts); people are made with the real owner commands. The tests run
// side by side on that one memory, so each finds its own comments by their text.
import { type Browser, type Page, expect, test } from '@playwright/test'
import { addPerson, apiUrl, fruit, ownerCommand, publishableKey, secretKey } from './support.ts'

const CHAT = 'Kaş Tatili'
let path = ''

test.beforeAll(async () => {
  const found = await fetch(`${apiUrl}/rest/v1/memories?select=key,chats!inner(name)&chats.name=eq.${encodeURIComponent(CHAT)}`, {
    headers: { apikey: secretKey },
  })
  path = `/m/${((await found.json()) as { key: string }[])[0]!.key}`
})

async function device(browser: Browser, locale: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale })
  return { context, page: await context.newPage() }
}

// Signs in with a personal link and opens the memory.
async function open(page: Page, link: string) {
  await page.goto(link)
  await expect(page.getByRole('article').first()).toBeVisible()
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

const notes = (page: Page) => page.getByRole('region', { name: /^(Comments|Yorumlar)$/ })
const note = (page: Page, text: string) => page.getByRole('article').filter({ hasText: text })

async function write(page: Page, text: string, label = 'Add comment') {
  await page.getByRole('textbox').fill(text)
  await page.getByRole('button', { name: label }).click()
}

test.describe('comments', () => {
  test('a friend adds a comment, it appears at once with name and time, keeps its line breaks and stays after a reload', async ({ browser }) => {
    const { context, page } = await device(browser, 'en-US')
    const name = fruit('Limon')
    await open(page, addPerson(name))
    const slip = page.getByRole('region', { name: 'Conversation' })

    await write(page, '  İlk satır\n\nüçüncü <b>satır</b> & &amp;  ')

    const added = note(page, 'İlk satır')
    await expect(added).toHaveCount(1)
    await expect(added.locator('.by')).toHaveText(name)
    await expect(added.locator('time')).toHaveText(/\d{4}.*\d{1,2}:\d{2}/)
    // Written text is text: the line breaks are kept, the angle brackets are not markup.
    expect(await added.locator('.text').evaluate((el: HTMLElement) => el.innerText)).toBe('İlk satır\n\nüçüncü <b>satır</b> & &amp;')
    await expect(added.locator('b')).toHaveCount(0)
    await expect(page.getByRole('textbox')).toHaveValue('')
    // The comment sits below the conversation and is not part of it.
    expect((await added.boundingBox())!.y).toBeGreaterThan((await slip.boundingBox())!.y + (await slip.boundingBox())!.height)
    await expect(slip.getByText('İlk satır')).toHaveCount(0)
    await expect(notes(page).getByText('Written here in Ezeli, later. Not part of the old chat.')).toBeVisible()

    await page.reload()
    await expect(note(page, 'İlk satır')).toHaveCount(1)
    await expect(note(page, 'İlk satır').locator('.by')).toHaveText(name)
    await context.close()
  })

  test('the same screen in Turkish, and an empty or blank comment cannot be added', async ({ browser }) => {
    const { context, page } = await device(browser, 'tr-TR')
    await open(page, addPerson(fruit('Karpuz')))

    await expect(notes(page).getByText("Ezeli'de sonradan yazıldı. Eski sohbetin parçası değil.")).toBeVisible()
    const add = page.getByRole('button', { name: 'Yorum ekle' })
    await expect(add).toBeDisabled()
    await page.getByRole('textbox').fill('  \n  ')
    await expect(add).toBeDisabled()
    await page.getByRole('textbox').fill('Güzel gündü')
    await add.click()
    await expect(note(page, 'Güzel gündü').getByRole('button', { name: 'Sil' })).toBeVisible()
    await context.close()
  })

  test('deleting asks once, and the comment is gone for good once confirmed', async ({ browser }) => {
    const { context, page } = await device(browser, 'en-US')
    await open(page, addPerson(fruit('Fıstık')))
    await write(page, 'silinecek not')
    const mine = note(page, 'silinecek not')

    await mine.getByRole('button', { name: 'Delete' }).click()
    await expect(mine.getByText('Delete this comment?')).toBeVisible()
    await mine.getByRole('button', { name: 'Keep it' }).click()
    await expect(mine).toBeVisible()
    await expect(mine.getByText('Delete this comment?')).toHaveCount(0)

    await mine.getByRole('button', { name: 'Delete' }).click()
    await mine.getByRole('button', { name: 'Yes, delete' }).click()
    await expect(mine).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(notes(page)).toBeVisible()
    await expect(note(page, 'silinecek not')).toHaveCount(0)
    await context.close()
  })

  test('only the writer and an owner can delete a comment, and nobody can edit one', async ({ browser }) => {
    const writer = await device(browser, 'en-US')
    const other = await device(browser, 'en-US')
    const boss = await device(browser, 'en-US')
    await open(writer.page, addPerson(fruit('Limon')))
    await open(other.page, addPerson(fruit('Çilek')))
    await open(boss.page, addPerson(fruit('İncir'), { owner: true }))
    await write(writer.page, 'ortak anı')
    await expect(note(writer.page, 'ortak anı')).toBeVisible()

    // Another friend sees it, with no way to delete or edit it.
    await other.page.reload()
    const theirs = note(other.page, 'ortak anı')
    await expect(theirs).toBeVisible()
    await expect(theirs.getByRole('button')).toHaveCount(0)
    await expect(other.page.getByRole('textbox')).toHaveCount(1)
    // The app does not offer it, and asking the server directly is refused too.
    const token = await other.page.evaluate(() => {
      const key = Object.keys(localStorage).find((name) => name.endsWith('-auth-token'))!
      return JSON.parse(localStorage.getItem(key)!).access_token as string
    })
    const headers = { apikey: publishableKey, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' }
    const where = `${apiUrl}/rest/v1/comments?body=eq.${encodeURIComponent('ortak anı')}`
    expect(await (await fetch(where, { method: 'DELETE', headers })).json()).toEqual([])
    expect((await fetch(where, { method: 'PATCH', headers, body: JSON.stringify({ body: 'değişti' }) })).ok).toBe(false)
    await writer.page.reload()
    await expect(note(writer.page, 'ortak anı')).toBeVisible()

    // An owner can delete it.
    await boss.page.reload()
    const toBoss = note(boss.page, 'ortak anı')
    await toBoss.getByRole('button', { name: 'Delete' }).click()
    await toBoss.getByRole('button', { name: 'Yes, delete' }).click()
    await expect(toBoss).toHaveCount(0)
    await writer.page.reload()
    await expect(notes(writer.page)).toBeVisible()
    await expect(note(writer.page, 'ortak anı')).toHaveCount(0)
    for (const { context } of [writer, other, boss]) await context.close()
  })

  test('a visitor with no link sees no comments, and the owner list shows who has commented', async ({ browser }) => {
    const friend = await device(browser, 'en-US')
    const visitor = await device(browser, 'en-US')
    const name = fruit('Karpuz')
    await open(friend.page, addPerson(name))
    await write(friend.page, 'sadece arkadaşlar görür')
    await expect(note(friend.page, 'sadece arkadaşlar görür')).toBeVisible()

    await visitor.page.goto(path)
    await expect(visitor.page.getByText('Ezeli is private')).toBeVisible()
    await expect(visitor.page.getByText('sadece arkadaşlar görür')).toHaveCount(0)
    const read = await fetch(`${apiUrl}/rest/v1/comments?select=body`, { headers: { apikey: publishableKey } })
    expect(read.ok).toBe(false)

    const row = ownerCommand(['person', 'list']).stdout.split('\n').find((line) => line.includes(name))
    expect(row).toMatch(/yes +no +1 +\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/)
    await friend.context.close()
    await visitor.context.close()
  })
})
