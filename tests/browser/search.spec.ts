// Search, as friends use it on a phone, against the local Supabase. The memories are the ones the
// real import saved (import.setup.ts) plus two chats imported here. People are made with the real
// owner commands, and comments are written through the app.
import { type Browser, type Page, expect, test } from '@playwright/test'
import { rmSync } from 'node:fs'
import { makeSmallExport } from './large.ts'
import { addPerson, apiUrl, fruit, ownerCommand, photoCount, publishableKey, sentBy } from './support.ts'

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
      { when: '08.03.2022, 10:00:00', text: 'Şeftali topladık' },
      { when: '09.03.2022, 10:00:00', text: 'gece yürüyüşü' },
      { when: '10.03.2022, 10:00:00', text: 'Café açıldı' },
    ]),
    'Arama Sohbeti',
  )
  // More memories than one page of results, all with the same word.
  load(
    await makeSmallExport(Array.from({ length: 30 }, (_, i) => ({ when: `${String(i + 1).padStart(2, '0')}.05.2021, 12:00:00`, text: `Deniz kenarı ${i + 1}` }))),
    'Deniz Sohbeti',
  )
  // More than a hundred matches, so the database looks for candidates more than once for a page.
  const start = Date.UTC(2020, 0, 1)
  const stamp = (i: number) => new Date(start + i * 86_400_000).toISOString().slice(0, 10).split('-').reverse().join('.')
  load(await makeSmallExport(Array.from({ length: 130 }, (_, i) => ({ when: `${stamp(i)}, 09:00:00`, text: `Kıyı yürüyüşü ${i + 1}` }))), 'Kıyı Sohbeti')
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
    await expect(page.getByText(/Type a word from the messages or comments, or a name\./)).toBeVisible()
    await expect(results(page)).toHaveCount(0)
  })

  test('a word from a message finds that memory, whatever its capital letters', async ({ page }) => {
    await openSearch(page)

    await find(page, 'TEKNEYE')

    await expect(results(page)).toHaveCount(1)
    expect(await dates(page)).toEqual([JULY14])
    await expect(sentBy(results(page))).toContainText('Sent by')
    await expect(photoCount(results(page))).toContainText('photos')
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
    // Saved: the box is emptied and the note is shown among the comments (the typed text is not yet).
    await expect(page.getByRole('textbox')).toHaveValue('')
    await expect(page.getByRole('article').filter({ hasText: `Bu ${word} çorbası harikaydı` })).toBeVisible()
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
    for (const typed of ['100%', 'indirim_var', 'var \\ ve']) {
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
    await expect(page.getByText(/Type a word from the messages or comments, or a name\./)).toBeVisible()
    await expect(results(page)).toHaveCount(0)
  })

  test('pages like the timeline, and opening a result and coming back returns to the same results at the same place', async ({ page }) => {
    await openSearch(page)

    await find(page, 'deniz')

    await expect(results(page)).toHaveCount(20)
    expect((await dates(page))[0]).toBe('Sunday, May 30, 2021')
    await page.mouse.wheel(0, 100000)
    // The last of the thirty, the 1st of May: newest first, so it comes last.
    const last = results(page).filter({ hasText: 'Saturday, May 1, 2021' })
    await expect(last).toBeVisible()
    await last.scrollIntoViewIfNeeded()
    await last.getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saturday, May 1, 2021')
    // Back names the list the memory was opened from.
    await expect(page.getByRole('button', { name: /Search$/ })).toBeVisible()

    await page.goBack()

    await expect(box(page)).toHaveValue('deniz')
    await expect(results(page).filter({ hasText: 'Saturday, May 1, 2021' })).toBeInViewport()
  })

  test('goes on past a hundred matches: each once, newest first, and the page holds only the cards near the screen', async ({ page }) => {
    await openSearch(page)
    const keys: string[] = []
    const ats: string[] = []
    page.on('response', async (response) => {
      if (!response.url().includes('/rpc/search_memories')) return
      for (const row of (await response.json()) as { key: string; local_at: string }[]) {
        keys.push(row.key)
        ats.push(row.local_at)
      }
    })

    await find(page, 'kiyi yuruyusu')
    let held = 0
    for (let i = 0; i < 80 && keys.length < 130; i += 1) {
      await page.mouse.wheel(0, 3000)
      await page.waitForTimeout(150)
      held = Math.max(held, await results(page).count())
    }
    await expect.poll(() => keys.length).toBe(130)

    expect(new Set(keys).size).toBe(130)
    expect(ats).toEqual(ats.slice().sort().reverse())
    expect(held).toBeLessThan(100)
  })

  test('has a main heading', async ({ page }) => {
    await openSearch(page)

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Search')
  })

  test('a word matches only at the start of a word, in messages and in names', async ({ page }) => {
    await openSearch(page)

    // "ali" is inside "Şeftali", "ece" inside "gece"/"geceler", "imon" inside the name Limon.
    for (const typed of ['ali', 'ece', 'imon', 'ftali', 'ilek']) {
      await find(page, typed)
      await expect(nothing(page), typed).toBeVisible()
    }
    // The start of a word still finds it, with or without the Turkish letters.
    await find(page, 'sef')
    await expect(results(page)).toHaveCount(1)
    expect(await dates(page)).toEqual([march(8)])
    await find(page, 'ista')
    await expect(results(page).filter({ hasText: 'March' })).toHaveCount(4)
    await find(page, 'gec')
    await expect(results(page).filter({ hasText: 'March 9, 2022' })).toHaveCount(1)
    await find(page, 'lim')
    await expect(results(page).filter({ hasText: JULY14 })).toHaveCount(1)
    // A word after a punctuation mark is the start of a word.
    await find(page, 'var')
    await expect(results(page).filter({ hasText: 'March 7, 2022' })).toHaveCount(1)
  })

  test('treats a letter typed as one character or as a letter and a mark the same way', async ({ page }) => {
    await openSearch(page)

    await find(page, 'şarkı')
    await expect(results(page)).toHaveCount(1)
    expect(await dates(page)).toEqual([march(5)])
    for (const typed of ['café', 'café', 'CAFÉ']) {
      await find(page, typed)
      await expect(results(page), typed).toHaveCount(1)
      expect(await dates(page), typed).toEqual([march(10)])
    }
    await find(page, 'İstanbul')
    await expect(results(page).filter({ hasText: 'March' })).toHaveCount(4)
  })

  test('a word of one or two letters, or of punctuation or emoji, waits for Enter, and the hint says so', async ({ page }) => {
    await openSearch(page)
    await expect(page.getByText(/one or two letters/)).toBeVisible()
    const asked: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/rpc/search_memories')) asked.push(request.postData() ?? '')
    })

    for (const typed of ['ab', 'a b', '...', '😂😂😂', '!!!']) {
      await box(page).fill('')
      await box(page).pressSequentially(typed, { delay: 20 })
      await page.waitForTimeout(700)
      expect(asked, typed).toHaveLength(0)
    }
    await box(page).fill('ye')
    await box(page).press('Enter')
    await expect(results(page).first()).toBeVisible()
    expect(asked).toHaveLength(1)
    // A longer word beside a short one is searched as the friend pauses.
    await box(page).fill('')
    await box(page).pressSequentially('ye tekneye', { delay: 20 })
    await expect.poll(() => asked.length).toBe(2)
  })

  test('an older search that answers late never replaces a newer one', async ({ page }) => {
    await openSearch(page)
    let calls = 0
    await page.route(/\/rpc\/search_memories/, async (route) => {
      if (++calls === 1) await new Promise((done) => setTimeout(done, 1500))
      await route.continue().catch(() => {})
    })

    await find(page, 'tekneye')
    await find(page, 'zzzyyy')
    await expect(nothing(page)).toBeVisible()
    await page.waitForTimeout(2000)

    await expect(nothing(page)).toBeVisible()
    await expect(results(page)).toHaveCount(0)
    await expect(box(page)).toHaveValue('zzzyyy')
  })

  test('uses the first eight words and says so', async ({ page }) => {
    await openSearch(page)

    // The ninth word is in no memory: it is not searched.
    await find(page, 'tekneye gidiyoruz unutmayın yarın ışık şahane güzel çıkmış zzzyyy')

    await expect(results(page)).toHaveCount(1)
    expect(await dates(page)).toEqual([JULY14])
    await expect(page.getByText('Only the first 8 words were searched.')).toBeVisible()
    await find(page, 'tekneye gidiyoruz')
    await expect(page.getByText('Only the first 8 words were searched.')).toHaveCount(0)
  })

  test('does not find what is not stored: a left-out sender’s text, or the line shown for a video or a voice message', async ({ page }) => {
    await openSearch(page)

    // Çilek is left out of the made-up people file, so "Ben de çektim bir tane" was never saved.
    for (const typed of ['çektim', 'video', 'voice', 'document', 'not in the export']) {
      await find(page, typed)
      await expect(nothing(page), typed).toBeVisible()
    }
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

  test('the function itself answers nothing to a token kept from before the link was replaced', async ({ page, request }) => {
    const name = fruit('Limon')
    await openSearch(page, addPerson(name))
    const token = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'))!
      return JSON.parse(localStorage.getItem(key)!).access_token as string
    })
    const ask = async (words: string) => (await request.post(`${apiUrl}/rest/v1/rpc/search_memories`, { headers: { apikey: publishableKey, authorization: `Bearer ${token}` }, data: { p_query: words } })).json()
    expect(((await ask('tekneye')) as unknown[]).length).toBe(1)

    ownerCommand(['person', 'relink', '--name', name])

    expect(await ask('tekneye')).toEqual([])
    expect(await ask('a')).toEqual([])
  })
})
