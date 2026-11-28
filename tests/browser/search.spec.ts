// Search, as friends use it on a phone. The owner import seeds the memories and people,
// and comments are written through the app.
import { type Browser, type Page, expect, test } from '@playwright/test'
import { addPerson, apiUrl, expectNoSidewaysScroll, fruit, openWide, ownerCommand, photoCount, publishableKey, sentBy } from './support.ts'

const results = (page: Page) => page.getByRole('article')
const box = (page: Page) => page.getByRole('searchbox')
const dates = (page: Page) => results(page).getByRole('heading').allTextContents()
const JULY14 = 'Friday, July 14, 2023'
const nothing = (page: Page) => page.getByRole('heading', { name: 'Nothing found' })

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
    await expect(results(page).getByRole('blockquote')).toContainText(/tekneye/i)
    await results(page).getByRole('link').click()
    const hit = page.getByRole('region', { name: 'Conversation' }).locator('mark')
    await expect(hit).toHaveText(/tekneye/i)
    await expect(hit).toBeInViewport()
    await expect(page).toHaveURL(/\/m\/[^/?#]+$/)
  })

  test('a long exact comment match is fully visible and disappears from Search after deletion', async ({ page }) => {
    const phrase = `mercimek${Date.now().toString(36)} characteristically disproportionate counterintuitive uncharacteristically incomprehensible institutionalization unpredictability`
    const comment = `This is the beginning of the note: ${phrase} and there is more after it.`
    await openSearch(page)
    await find(page, phrase)
    await expect(nothing(page)).toBeVisible()

    await page.goto('/')
    await results(page).filter({ hasText: 'Çok güzel çıkmış' }).click()
    await page.getByRole('textbox').fill(comment)
    await page.getByRole('button', { name: 'Add comment' }).click()
    await expect(page.getByText(comment, { exact: true })).toBeVisible()
    await page.goto('/search')
    await find(page, phrase.toUpperCase())

    await expect(results(page)).toHaveCount(1)
    expect(await dates(page)).toEqual([JULY14])
    const quote = results(page).getByRole('blockquote')
    await expect(quote).toContainText(phrase)
    expect(await quote.evaluate((node) => node.scrollHeight - node.clientHeight)).toBe(0)
    await results(page).getByRole('link').click()
    const note = page.getByRole('region', { name: 'Comments' }).getByRole('article').filter({ hasText: phrase })
    const hits = note.locator('mark')
    await expect(hits).toHaveText(phrase.split(' '))
    await expect(hits.first()).toBeInViewport()
    await note.getByRole('button', { name: 'Delete' }).click()
    await note.getByRole('button', { name: 'Yes, delete' }).click()
    await expect(note).toHaveCount(0)
    await page.goBack()
    await expect(nothing(page)).toBeVisible()
    await expect(results(page)).toHaveCount(0)
  })

  test('the first exact phrase wins and opens a deep match with context on both sides', async ({ page }) => {
    await openSearch(page)
    await find(page, 'pusula rota')
    await expect(results(page)).toHaveCount(1)
    await expect(results(page).getByRole('blockquote')).toContainText('Pusula rota ilk')
    await results(page).getByRole('link').click()
    const conversation = page.getByRole('region', { name: 'Conversation' })
    await expect(conversation.locator('mark')).toHaveText(['Pusula', 'Pusula', 'rota'])
    await expect(conversation.getByText('Pusula rota ilk')).toBeInViewport()
    await expect(conversation.getByText('Pusula rota ikinci')).toBeVisible()
    await expect(conversation.getByText('Context 13', { exact: true })).toBeVisible()
    await expect(conversation.getByText('Context 0', { exact: true })).toHaveCount(0)
    await conversation.getByRole('button', { name: /earlier messages/i }).click()
    await expect(conversation.getByText('Context 0', { exact: true })).toBeVisible()
    await conversation.getByRole('button', { name: /later messages/i }).click()
    await expect(conversation.getByText('Later context 8', { exact: true })).toBeVisible()
    await page.getByRole('textbox').fill('Pusula rota comment')
    await page.getByRole('button', { name: 'Add comment' }).click()
    await expect(page.getByText('Pusula rota comment')).toBeVisible()
    await page.goBack()
    await expect(results(page).getByRole('blockquote')).toContainText('Pusula rota ilk')
    await find(page, 'PUSULA ROTA')
    await expect(results(page).getByRole('blockquote')).toContainText('Pusula rota ilk')
    await find(page, 'pusula context')
    await expect(results(page)).toHaveCount(1)
    await results(page).getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1 })).toBeInViewport()
    await expect(conversation.locator('mark')).toHaveCount(0)
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

  test('coming back after the next page loaded shows the words that were searched, not what was typed since', async ({ page }) => {
    await openSearch(page)
    await find(page, 'deniz')
    await expect(results(page)).toHaveCount(20)

    // Too short to search without Enter, so the results stay those of "deniz".
    await box(page).fill('ab')
    await page.mouse.wheel(0, 100000)
    const last = results(page).filter({ hasText: 'Saturday, May 1, 2021' })
    await expect(last).toBeVisible()
    await last.scrollIntoViewIfNeeded()
    await last.getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saturday, May 1, 2021')
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

  test('the box sits above the hint, and the screen does not scroll sideways at any width', async ({ browser }) => {
    for (const width of [390, 900, 1440, 1920]) {
      const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')), { width })
      await expect(results(page).first()).toBeVisible()
      await page.goto('/search')
      const hint = page.getByText(/Type a word from the messages or comments, or a name\./)
      await expect(hint).toBeVisible()
      const [at, under] = [await box(page).boundingBox(), await hint.boundingBox()]
      expect(at!.y, `${width}`).toBeLessThan(200)
      expect(under!.y, `${width}`).toBeGreaterThan(at!.y + at!.height - 1)
      await expectNoSidewaysScroll(page)
      await find(page, 'deniz')
      await expect(results(page).first()).toBeVisible()
      await expectNoSidewaysScroll(page)
      await find(page, 'zzzyyy')
      await expect(nothing(page)).toBeVisible()
      await expectNoSidewaysScroll(page)
      await context.close()
    }
  })

  test('on a wide window the results sit beside the bar as rows, and the states are in Turkish with Turkish labels', async ({ browser }) => {
    const { context, page } = await openWide(browser, addPerson(fruit('Karpuz')), { locale: 'tr-TR' })
    await expect(results(page).first()).toBeVisible()
    await page.getByRole('navigation', { name: 'Sayfalar' }).getByRole('link', { name: 'Ara', exact: true }).click()
    await expect(page.getByText(/Mesajlardan ya da yorumlardan/)).toBeVisible()
    await page.getByRole('searchbox').fill('tekneye')
    await expect(results(page)).toHaveCount(1)
    const [card, bar] = [await results(page).boundingBox(), await page.getByRole('navigation', { name: 'Sayfalar' }).boundingBox()]
    expect(card!.x).toBeGreaterThanOrEqual(bar!.x + bar!.width)
    expect(card!.height).toBeLessThan(400)
    await page.getByRole('searchbox').fill('zzzyyy')
    await expect(page.getByRole('heading', { name: 'Hiçbir şey bulunamadı' })).toBeVisible()
    await page.route(/\/rpc\/search_memories/, (route) => route.fulfill({ status: 500, json: { message: 'no' } }))
    await page.getByRole('searchbox').fill('tekneye')
    await page.getByRole('searchbox').press('Enter')
    await expect(page.getByRole('alert').getByRole('button', { name: 'Tekrar dene' })).toBeVisible()
    await context.close()
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
    const refused = await fetch(`${apiUrl}/rest/v1/rpc/search_memories_with_matches`, {
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

  test('the search function checks distinct query words and rejects a replaced session', async ({ page, request }) => {
    const name = fruit('Limon')
    await openSearch(page, addPerson(name))
    const token = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'))!
      return JSON.parse(localStorage.getItem(key)!).access_token as string
    })
    const ask = async (words: string) => (await request.post(`${apiUrl}/rest/v1/rpc/search_memories_with_matches`, { headers: { apikey: publishableKey, authorization: `Bearer ${token}` }, data: { p_query: words } })).json()
    expect(((await ask('tekneye')) as unknown[]).length).toBe(1)
    const split = await ask('pusula '.repeat(8) + 'context')
    expect(split).toHaveLength(1)
    expect(split[0].match).toBeNull()

    ownerCommand(['person', 'relink', '--name', name])

    expect(await ask('tekneye')).toEqual([])
    expect(await ask('a')).toEqual([])
  })
})
