// Hiding as a friend sees it. The data is the real import of the made-up weekend export under a chat
// of its own, and the real owner commands `memory`, `hide` and `show`. Hiding adds no screen: the
// memory and the timeline must simply not show what is hidden, and a signed-in person's own token
// must not be able to read it from the database or the bucket either.
import { createClient } from '@supabase/supabase-js'
import { cpSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { type Page, expect, test } from '@playwright/test'
import { localStack } from '../stack.ts'
import { addPerson, apiUrl, fruit, ownerCommand, publishableKey } from './support.ts'

const CHAT = 'Gizli Tatil'
const stack = localStack()
const owner = createClient(stack.apiUrl, stack.secretKey, { auth: { persistSession: false } })
test.describe.configure({ mode: 'serial' })

let july14 = ''
let july15 = ''
const ids: string[] = []

// The made-up photos of the fixtures are all the same bytes; a hidden photo is also known by its
// bytes, so give each its own colour, as real photos have.
async function distinctWeekend(): Promise<string> {
  const folder = mkdtempSync(join(tmpdir(), 'ezeli-gizli-'))
  cpSync('tests/fixtures/whatsapp-iphone/weekend', folder, { recursive: true })
  for (const [index, name] of readdirSync(folder).filter((file) => file.endsWith('.jpg')).entries()) {
    await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 30 + index * 37, g: 90, b: 140 } } }).jpeg().toFile(join(folder, name))
  }
  return folder
}

// A memory's address now: it moves when its first photo is hidden.
const addressOf = async (id: string) => (await owner.from('memories').select('key').eq('id', id).single()).data!.key as string

test.beforeAll(async () => {
  const result = ownerCommand(['import', await distinctWeekend(), '--people', 'tests/fixtures/whatsapp-iphone/people.json', '--timezone', 'Europe/Istanbul', '--chat', CHAT])
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  const chat = await owner.from('chats').select('id').eq('name', CHAT).single()
  const found = await owner.from('memories').select('id, key').eq('chat_id', chat.data!.id).order('at')
  ids.push(...found.data!.map((memory) => memory.id))
  ;[july14, july15] = found.data!.map((memory) => memory.key)
})

// The number of the first line of the owner's listing that matches.
function numberOf(key: string, matching: RegExp): string {
  const listing = ownerCommand(['memory', `/m/${key}`]).stdout
  const line = listing.split('\n').find((candidate) => matching.test(candidate))
  if (!line) throw new Error(`no line matches ${matching}:\n${listing}`)
  return line.trim().split(/\s+/)[0]!
}

async function signIn(page: Page) {
  await page.goto(addPerson(fruit('Karpuz')))
  await expect(page.getByRole('article').first()).toBeVisible()
}

const talk = (page: Page) => page.getByRole('region', { name: 'Conversation' })
const keyLinks = (page: Page, key: string) => page.locator(`a[href$="/m/${key}"]`)

test('a hidden photo and a hidden message are gone from the memory, and the link to the photo stops working', async ({ page, request }) => {
  await signIn(page)
  await page.goto(`/m/${july14}`)
  await expect(page.locator('.prints img')).toHaveCount(2)
  await expect(talk(page).getByText('Yarın tekneye gidiyoruz')).toBeVisible()
  const held = await page.locator('.prints img').first().getAttribute('src')
  expect((await request.get(held!)).ok()).toBe(true)

  const photo = ownerCommand(['hide', july14, numberOf(july14, /\[Photo\]/)])
  const next = await addressOf(ids[0]!)
  const message = ownerCommand(['hide', next, numberOf(next, /Yarın tekneye gidiyoruz/)])
  expect(photo.status).toBe(0)
  expect(message.status).toBe(0)

  // The memory looks as if the photo was never sent: its address is now the next photo's.
  expect(await addressOf(ids[0]!)).not.toBe(july14)
  await page.goto(`/m/${july14}`)
  await expect(page.getByRole('heading', { name: 'This memory is not here' })).toBeVisible()
  await page.goto(`/m/${await addressOf(ids[0]!)}`)
  await expect(page.locator('.prints img')).toHaveCount(1)
  await expect(talk(page).locator('img')).toHaveCount(1)
  await expect(talk(page).getByText('Yarın tekneye gidiyoruz')).toHaveCount(0)
  // A link a friend already held opens nothing: the files are gone.
  expect((await request.get(held!)).ok()).toBe(false)
  // Hiding is not a change of grouping: the rest of the conversation is still there.
  await expect(talk(page).getByText('Çok güzel çıkmış')).toBeVisible()
})

test('a hidden message returns with the next import once it is shown, not before', async ({ page }) => {
  await signIn(page)
  const listing = ownerCommand(['hidden']).stdout.split('\n')
  const start = listing.findIndex((line) => line.trim() === CHAT)
  const number = listing.slice(start + 1).find((line) => /Limon.*: message/.test(line))!.trim().split(/\s+/)[0]!
  expect(ownerCommand(['show', number]).status).toBe(0)

  await page.goto(`/m/${await addressOf(ids[0]!)}`)
  await expect(talk(page).getByText('Yarın tekneye gidiyoruz')).toHaveCount(0)
  const again = ownerCommand(['import', await distinctWeekend(), '--people', 'tests/fixtures/whatsapp-iphone/people.json', '--timezone', 'Europe/Istanbul', '--chat', CHAT])
  expect(again.status).toBe(0)
  await page.goto(`/m/${await addressOf(ids[0]!)}`)
  await expect(talk(page).getByText('Yarın tekneye gidiyoruz')).toBeVisible()
})

test('a memory whose only photo is hidden leaves the timeline, and its address is a memory that is not there', async ({ page }) => {
  await signIn(page)
  await expect(keyLinks(page, july15)).toHaveCount(1)
  const before = await page.getByRole('article').count()

  expect(ownerCommand(['hide', july15, numberOf(july15, /\[Photo\]/)]).status).toBe(0)

  await page.goto('/')
  await expect(page.getByRole('article')).toHaveCount(before - 1)
  await expect(keyLinks(page, july15)).toHaveCount(0)
  await page.goto(`/m/${july15}`)
  await expect(page.getByRole('heading', { name: 'This memory is not here' })).toBeVisible()
  // Nothing of it, not even the sentence after the photo.
  await expect(page.getByText('Şu suyun rengine bak')).toHaveCount(0)
})

test('with the friend\'s own token, nothing hidden can be read from the database or the bucket', async ({ page, request }) => {
  await signIn(page)
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.endsWith('-auth-token'))!
    return JSON.parse(localStorage.getItem(key)!).access_token as string
  })
  const headers = { apikey: publishableKey, authorization: `Bearer ${token}` }
  const get = async (path: string) => (await request.get(`${apiUrl}/rest/v1/${path}`, { headers })).json()

  const memory = { data: { id: ids[1]! } }
  expect(await get(`memories?id=eq.${memory.data!.id}&select=id`)).toEqual([])
  expect(await get(`messages?memory_id=eq.${memory.data!.id}&select=id`)).toEqual([])
  expect(await get(`photos?memory_id=eq.${memory.data!.id}&select=id`)).toEqual([])
  expect(await get(`timeline?id=eq.${memory.data!.id}&select=id`)).toEqual([])
  expect((await request.get(`${apiUrl}/rest/v1/hidden?select=id`, { headers })).ok()).toBe(false)
  expect((await request.get(`${apiUrl}/rest/v1/chats?select=secret`, { headers })).ok()).toBe(false)
  expect((await request.get(`${apiUrl}/rest/v1/photos?select=content_hash`, { headers })).ok()).toBe(false)
  const detail = await request.post(`${apiUrl}/rest/v1/rpc/memory_detail`, { headers, data: { p_key: july15 } })
  expect(await detail.json()).toBeNull()

  // The hidden photo of the 14th: no row, no file, in either size.
  const files = await owner.storage.from('photos').list((await owner.from('chats').select('id').eq('name', CHAT).single()).data!.id)
  const keys = (await owner.from('photos').select('key').in('key', [july15])).data
  expect(keys).toEqual([])
  expect(files.data!.some((file) => file.name.startsWith(july15))).toBe(false)
})
