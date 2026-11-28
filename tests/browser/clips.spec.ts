import { expect, test } from '@playwright/test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { clipPeople, makeClipExport } from '../clip-export.ts'
import { addPerson, fruit, ownerCommand } from './support.ts'

test('restores playback in place, retains an omitted file, and hides one same-minute clip', async ({ page, browser, request }) => {
  test.setTimeout(90_000)
  const { dir, first } = await makeClipExport()
  const content = readFileSync(first)
  const command = ['import', dir, '--people', clipPeople, '--timezone', 'UTC', '--chat', 'Clip playback']
  const load = () => {
    const result = ownerCommand(command)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  }
  const conversation = page.getByRole('region', { name: 'Conversation' })
  try {
    rmSync(first)
    load()
    await page.goto(addPerson(fruit('Karpuz')))
    await page.getByRole('link', { name: 'Search', exact: true }).click()
    await page.getByRole('searchbox').fill('First clip caption')
    await page.getByRole('article').filter({ hasText: 'Monday, November 21, 2022' }).getByRole('link').click()
    const memory = page.url()
    await expect(conversation.getByText('First clip caption')).toBeVisible()
    await expect(conversation.locator('video')).toHaveCount(2)
    await page.getByRole('textbox').fill('A fictional note to keep')
    await page.getByRole('button', { name: 'Add comment' }).click()
    await expect(page.getByText('A fictional note to keep')).toBeVisible()

    writeFileSync(first, content)
    load()
    await page.reload()
    await expect(page).toHaveURL(memory)
    await expect(page.getByText('A fictional note to keep')).toBeVisible()
    const video = conversation.locator('video').first()
    await expect(conversation.locator('video')).toHaveCount(3)
    await expect(conversation.locator('audio')).toHaveCount(1)
    await expect(conversation.getByText('Video', { exact: true })).toHaveCount(2)
    await expect(conversation.getByText('Document', { exact: true })).toHaveCount(1)
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true
      await element.play()
    })
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0)
    const audio = conversation.locator('audio')
    await audio.evaluate(async (element: HTMLAudioElement) => {
      element.muted = true
      await element.play()
    })
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration)).toBeGreaterThan(120)
    const url = (await video.getAttribute('src'))!

    const guest = await browser.newPage()
    try {
      await guest.goto(memory)
      await expect(guest.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()
      await expect(guest.locator('audio, video')).toHaveCount(0)
    } finally {
      await guest.close()
    }

    rmSync(first)
    load()
    await page.reload()
    await expect(conversation.locator('video')).toHaveCount(3)
    const listing = ownerCommand(['memory', memory])
    expect(listing.status).toBe(0)
    const code = listing.stdout.split('\n').find((line) => line.includes('10:01') && line.includes('[video]'))?.split(/\s+/)[0]
    expect(code).toBeTruthy()
    const hidden = ownerCommand(['hide', memory, code!, '--yes'])
    expect(hidden.status, hidden.stderr).toBe(0)
    const removed = await request.get(url)
    expect(removed.ok()).toBe(false)

    writeFileSync(first, content)
    load()
    await page.reload()
    await expect(page).toHaveURL(memory)
    await expect(conversation.locator('video')).toHaveCount(2)
    await expect(conversation.getByText('First clip caption')).toHaveCount(0)
    await expect(conversation.getByText('Second clip caption')).toBeVisible()
    await expect(page.getByText('A fictional note to keep')).toBeVisible()

    const unavailable = conversation.locator('video').first()
    const originalPlayer = await unavailable.elementHandle()
    const clipUrl = (await unavailable.getAttribute('src'))!
    await page.route((url) => url.pathname === new URL(clipUrl).pathname, (route) => route.fulfill({ status: 404 }))
    const play = (element: HTMLVideoElement) => element.play().catch(() => undefined)
    await unavailable.evaluate(play)
    await page.waitForFunction((element) => !element?.isConnected, originalPlayer)
    await unavailable.evaluate(play)
    await expect(conversation.locator('video')).toHaveCount(1)
    await expect(conversation.getByText('Video', { exact: true })).toHaveCount(3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
