// Search, as friends use it on a phone, against the local Supabase. The memories are the ones the
// real import saved (import.setup.ts) plus two chats imported here. People are made with the real
// owner commands, and comments are written through the app.
import { type Browser, type Page, expect, test } from '@playwright/test'
import { rmSync } from 'node:fs'
import { makeSmallExport } from './large.ts'
import { addPerson, apiUrl, fruit, ownerCommand, publishableKey } from './support.ts'

const people = 'tests/fixtures/whatsapp-iphone/people.json'
const results = (page: Page) => page.getByRole('article')
const box = (page: Page) => page.getByRole('searchbox')
const dates = (page: Page) => results(page).getByRole('heading').allTextContents()
const JULY14 = 'Friday, July 14, 2023'
const nothing = (page: Page) => page.getByRole('heading', { name: 'Nothing found' })

function load(dir: string, chat: string) {
  try {
    const result = ownerCommand(['import', dir, '--people', people, '--timezone', 'Europe/Istanbul', '--chat', chat, '--date-order', 'day-first'])
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test.beforeAll(async () => {
  // Turkish words in every form: dotted and dotless i, in capitals and not, and ş ğ ü ö ç.
  load(
    await makeSmallExport([
      { when: '01.03.2022, 10:00:00', text: 'İstanbul akşamı' },
      { when: '02.03.2022, 10:00:00', text: 'ISTANBUL SAHİLİ' },
      { when: '03.03.2022, 10:00:00', text: 'ıstanbul boğazı' },
      { when: '04.03.2022, 10:00:00', text: 'istanbul köprüsü' },
      { when: '05.03.2022, 10:00:00', text: 'Şarkı söyledik' },
      { when: '06.03.2022, 10:00:00', text: 'ÇİĞ KÖFTE yedik' },
      { when: '07.03.2022, 10:00:00', text: 'yüzde 50 indirim_var \\ ve 100%' },
    ]),
    'Arama Sohbeti',
  )
  // More memories than one page of results, all with the same word.
  load(
    await makeSmallExport(Array.from({ length: 30 }, (_, i) => ({ when: `${String(i + 1).padStart(2, '0')}.05.2021, 12:00:00`, text: `Deniz kenarı ${i + 1}` }))),
    'Deniz Sohbeti',
  )
})

async function device(browser: Browser, locale = 'en-US') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale })
  return { context, page: await context.newPage() }
}

// Signs in and opens the search screen from the timeline's header.
async function openSearch(page: Page, link = addPerson(fruit('Karpuz'))) {
  await page.goto(link)
  await expect(results(page).first()).toBeVisible()
  await page.getByRole('link', { name: 'Search', exact: true }).click()
  await expect(box(page)).toBeVisible()
}

async function find(page: Page, words: string) {
  await box(page).fill(words)
  await box(page).press('Enter')
}

const day = (n: number) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][n % 7]
// 1 March 2022 was a Tuesday.
const march = (n: number) => `${day(n)}, March ${n}, 2022`

test.describe('search', () => {
  test('has one box, no choice of what to search, and a hint before anything is typed', async ({ page }) => {
    await openSearch(page)

    await expect(page).toHaveURL(/\/search$/)
    await expect(box(page)).toHaveCount(1)
    await expect(page.getByRole('combobox')).toHaveCount(0)
    await expect(page.getByText('Type a word from the messages or comments, or a name.')).toBeVisible()
    await expect(results(page)).toHaveCount(0)
  })

  test('a word from a message finds that memory, whatever its capital letters', async ({ page }) => {
    await openSearch(page)

    await find(page, 'TEKNEYE')

    await expect(results(page)).toHaveCount(1)
    expect(await dates(page)).toEqual([JULY14])
    await expect(results(page).locator('.by')).toContainText('Sent by')
    await expect(results(page).locator('.counts')).toContainText('photos')
  })

  test('a word from a comment finds that memory, and not before the comment is written', async ({ page }) => {
    const word = `mercimek${Date.now().toString(36)}`
    await openSearch(page)
    await find(page, word)
    await expect(nothing(page)).toBeVisible()

    await page.goto('/')
    await results(page).filter({ hasText: 'Çok güzel çıkmış' }).click()
    await page.getByRole('textbox').fill(`Bu ${word} çorbası harikaydı`)
    await page.getByRole('button', { name: 'Add comment' }).click()
    await expect(page.getByText(`Bu ${word} çorbası harikaydı`)).toBeVisible()
    await page.goto('/search')
    await find(page, word.toUpperCase())

    await expect(results(page)).toHaveCount(1)
    expect(await dates(page)).toEqual([JULY14])
  })

  test('a name finds the memories that person sent a photo or a message in, and only those', async ({ page }) => {
    await openSearch(page)

    await find(page, 'fistik')

    // Fıstık sent in the two July memories and the March one; in none of the chats made here.
    await expect(results(page).first()).toBeVisible()
    const shown = await dates(page)
    expect(shown).toEqual(expect.arrayContaining(['Saturday, July 15, 2023', JULY14, 'Sunday, March 5, 2023']))
    expect(shown).not.toContain(march(1))
    // Limon sent in the 14th, and not in the 15th.
    await find(page, 'Limon')
    await expect(results(page).first()).toBeVisible()
    expect(await dates(page)).toContain(JULY14)
    expect(await dates(page)).not.toContain('Saturday, July 15, 2023')
  })

  test('several words narrow the result, also when they are in different places', async ({ page }) => {
    await openSearch(page)

    await find(page, 'ışık')
    await expect(results(page)).toHaveCount(1)
    await find(page, 'ışık tekneye')
    await expect(results(page)).toHaveCount(1)
    expect(await dates(page)).toEqual([JULY14])
    await find(page, 'ışık tekneye   Limon')
    await expect(results(page)).toHaveCount(1)
    await find(page, 'ışık tekneye istanbul')
    await expect(nothing(page)).toBeVisible()
  })

  test('treats Turkish letters sensibly in both directions', async ({ page }) => {
    await openSearch(page)

    // istanbul, ISTANBUL, İstanbul, İSTANBUL, ıstanbul and Istanbul all find the same four, newest first.
    for (const typed of ['istanbul', 'ISTANBUL', 'İstanbul', 'İSTANBUL', 'ıstanbul', 'Istanbul']) {
      await find(page, typed)
      // (A note in another chat of the tests mentions İstanbul too, in another year.)
      await expect(results(page).filter({ hasText: 'March' }), typed).toHaveCount(4)
      expect((await dates(page)).filter((date) => date.includes('2022')), typed).toEqual([march(4), march(3), march(2), march(1)])
    }
    // With Turkish letters and without.
    for (const typed of ['sarki', 'SARKI', 'şarkı', 'ŞARKI']) {
      await find(page, typed)
      await expect(results(page), typed).toHaveCount(1)
      expect(await dates(page), typed).toEqual([march(5)])
    }
    for (const typed of ['cig kofte', 'ÇİĞ KÖFTE', 'çiğ köfte', 'CIG KOFTE', 'cıg köfte']) {
      await find(page, typed)
      await expect(results(page), typed).toHaveCount(1)
      expect(await dates(page), typed).toEqual([march(6)])
    }
    await find(page, 'sahili')
    await expect(results(page)).toHaveCount(1)
    expect(await dates(page)).toEqual([march(2)])
  })

  test('takes the typed words as plain text, never as a pattern', async ({ page }) => {
    await openSearch(page)

    for (const typed of ['%%', '___', '.*', 'k%', 'k_k', '%\\', "'; drop table messages; --"]) {
      await find(page, typed)
      await expect(nothing(page), typed).toBeVisible()
    }
    // The characters themselves are found where they are written.
    for (const typed of ['100%', 'indirim_var', '_var', 'var \\ ve']) {
      await find(page, typed)
      await expect(results(page), typed).toHaveCount(1)
      expect(await dates(page)).toEqual([march(7)])
    }
    await find(page, 'indirim.var')
    await expect(nothing(page)).toBeVisible()
  })

  test('says so when nothing is found, and tells searching from not searching', async ({ page }) => {
    await openSearch(page)
    await page.route(/\/rpc\/search_memories/, async (route) => {
      await new Promise((done) => setTimeout(done, 800))
      await route.continue()
    })

    await find(page, 'zzzyyy')

    await expect(page.getByRole('status')).toHaveText('Searching')
    await expect(nothing(page)).toBeVisible()
    await expect(page.getByText('Try another word, or fewer words.')).toBeVisible()
    await expect(page.getByRole('status')).toHaveCount(0)
  })

  test('says so when the search fails, and tries again', async ({ page }) => {
    await openSearch(page)
    await page.route(/\/rpc\/search_memories/, (route) => route.fulfill({ status: 500, json: { message: 'no' } }))

    await find(page, 'tekneye')

    await expect(page.getByRole('alert').getByText('Could not load')).toBeVisible()
    await page.unroute(/\/rpc\/search_memories/)
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(results(page)).toHaveCount(1)
    expect(await dates(page)).toEqual([JULY14])
  })

  test('searches as the friend types without a request per letter, and keeps the words out of the address', async ({ page }) => {
    await openSearch(page)
    const asked: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/rpc/search_memories')) asked.push(request.postData() ?? '')
    })

    await box(page).pressSequentially('tekneye', { delay: 30 })

    await expect(results(page)).toHaveCount(1)
    expect(asked).toHaveLength(1)
    expect(page.url()).not.toContain('tekneye')
    await find(page, 'tekneye gidiyoruz')
    await expect(results(page)).toHaveCount(1)
    expect(page.url()).not.toMatch(/tekneye|gidiyoruz|\?|#/)
    // Clearing the box goes back to the hint.
    await box(page).fill('')
    await expect(page.getByText('Type a word from the messages or comments, or a name.')).toBeVisible()
    await expect(results(page)).toHaveCount(0)
  })

  test('pages like the timeline, and opening a result and coming back returns to the same results at the same place', async ({ page }) => {
    await openSearch(page)

    await find(page, 'deniz')

    await expect(results(page)).toHaveCount(20)
    await page.mouse.wheel(0, 100000)
    await expect(results(page)).toHaveCount(30)
    const all = await dates(page)
    // Newest first: the 30th of May 2021 down to the 1st.
    expect(all[0]).toBe('Sunday, May 30, 2021')
    expect(all.at(-1)).toBe('Saturday, May 1, 2021')
    const middle = results(page).nth(24)
    await middle.scrollIntoViewIfNeeded()
    const title = await middle.getByRole('heading').innerText()
    await middle.getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)

    await page.goBack()

    await expect(box(page)).toHaveValue('deniz')
    await expect(results(page)).toHaveCount(30)
    await expect(results(page).filter({ hasText: title })).toBeInViewport()
  })

  test('a visitor gets nothing, and a session that has ended is shown the private page', async ({ browser }) => {
    const refused = await fetch(`${apiUrl}/rest/v1/rpc/search_memories`, {
      method: 'POST',
      headers: { apikey: publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({ p_query: 'tekneye' }),
    })
    expect(refused.ok).toBe(false)

    const name = fruit('Limon')
    const { context, page } = await device(browser)
    await openSearch(page, addPerson(name))
    ownerCommand(['person', 'relink', '--name', name])

    await find(page, 'tekneye')

    await expect(page.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()
    await context.close()
  })
})
