import { expect, test } from '@playwright/test'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { addPerson, apiUrl, expectNoSidewaysScroll, fruit, ownerCommand, publishableKey } from './support.ts'

test.use({ locale: 'en-US' })
test.describe.configure({ mode: 'serial' })

test('the globe loads on demand and explains an unlocated collection in either language', async ({ page }) => {
  const queries: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/rest/v1/located_photos')) queries.push(request.url())
  })
  await page.goto(addPerson(fruit('Limon')))
  const globe = page.getByRole('link', { name: 'Globe', exact: true })
  await expect(globe).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  expect(queries).toEqual([])
  await globe.click()
  await expect(page.getByText('No located photos yet')).toBeVisible()
  expect(queries.length).toBeGreaterThan(0)
  await expectNoSidewaysScroll(page)
  await page.getByRole('button', { name: /^Menu:/ }).click()
  await page.getByRole('button', { name: 'Türkçe' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Kapat' }).click()
  await expect(page.getByText('Henüz konumu bilinen fotoğraf yok')).toBeVisible()
  await expectNoSidewaysScroll(page)
})

test('a friend explores a region, opens the exact photo and returns to its conversation', async ({ page, request }) => {
  const folder = mkdtempSync(join(tmpdir(), 'ezeli-globe-'))
  const jpg = '00000009-PHOTO-2023-07-14-21-10-05.jpg'
  try {
    cpSync('tests/fixtures/whatsapp-iphone/weekend', folder, { recursive: true })
    await sharp({ create: { width: 640, height: 480, channels: 3, background: '#b97e54' } })
      .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 10/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '33/1 21/1 0/1' } })
      .jpeg()
      .toFile(join(folder, jpg))
    const result = ownerCommand(['import', folder, '--people', 'tests/fixtures/whatsapp-iphone/people.json',
      '--timezone', 'Europe/Istanbul', '--chat', 'Copper Coast'])
    expect(result.status, result.stderr).toBe(0)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }

  const anonymous = await request.get(`${apiUrl}/rest/v1/located_photos?select=*`, { headers: { apikey: publishableKey } })
  expect(anonymous.ok()).toBe(false)
  await page.goto('/globe')
  await expect(page.getByRole('heading', { name: 'Ezeli is private' })).toBeVisible()
  await page.goto(addPerson(fruit('Limon')))
  await page.getByRole('link', { name: 'Globe', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: 'Photo sent by Karpuz' }).click()
  const choice = page.getByRole('link', { name: 'Open photo sent by Karpuz' })
  await expect(choice.getByRole('img')).toBeVisible()
  await choice.click()
  const viewer = page.getByRole('dialog', { name: 'Photo' })
  await expect(viewer.getByText('2 / 2')).toBeVisible()
  await viewer.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('region', { name: 'Conversation' }).getByText('Çok güzel çıkmış!')).toBeVisible()
  const path = new URL(page.url()).pathname
  await page.getByRole('button', { name: 'Globe' }).click()
  await expect(page.getByRole('heading', { name: 'Globe' })).toBeVisible()

  const hidden = ownerCommand(['hide', path, '--yes'])
  expect(hidden.status, hidden.stderr).toBe(0)
  await page.reload()
  await expect(page.getByText('No located photos yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Photo sent by Karpuz' })).toHaveCount(0)
})

test('photos at a shared location stay individually reachable and Back returns to the same view', async ({ page }) => {
  const folder = mkdtempSync(join(tmpdir(), 'ezeli-regions-'))
  const other = '00000023-PHOTO-2023-07-14-21-11-00.jpg'
  try {
    cpSync('tests/fixtures/whatsapp-iphone/weekend', folder, { recursive: true })
    const chatFile = join(folder, '_chat.txt')
    const chat = readFileSync(chatFile, 'utf8').replace('[14.07.2023, 21:12:00]', `[14.07.2023, 21:11:00] Fıstık F: <attached: ${other}>\n[14.07.2023, 21:12:00]`)
    writeFileSync(chatFile, chat)
    for (const [file, color, lat, lon] of [
      ['00000007-PHOTO-2023-07-14-20-58-11.jpg', '#706543', 35, 33],
      ['00000009-PHOTO-2023-07-14-21-10-05.jpg', '#b97e54', 35, 33],
      [other, '#825972', 39, 26],
    ] as const) {
      await sharp({ create: { width: 640, height: 480, channels: 3, background: color } })
        .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: `${lat}/1 0/1 0/1`, GPSLongitudeRef: 'E', GPSLongitude: `${lon}/1 0/1 0/1` } })
        .jpeg().toFile(join(folder, file))
    }
    const result = ownerCommand(['import', folder, '--people', 'tests/fixtures/whatsapp-iphone/people.json',
      '--timezone', 'Europe/Istanbul', '--chat', 'Two Harbours'])
    expect(result.status, result.stderr).toBe(0)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(addPerson(fruit('Limon')))
  await page.getByRole('link', { name: 'Globe', exact: true }).click()
  const cluster = page.getByRole('button', { name: '3 photos in this area' })
  await cluster.click()
  await expect(page.getByRole('link', { name: /Open photo sent by/ })).toHaveCount(3)
  for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Zoom in' }).click()
  const globe = page.getByRole('img', { name: 'World map' })
  await globe.press('ArrowLeft')
  const shared = page.getByRole('button', { name: '2 photos in this area' })
  await expect(shared).toBeVisible()
  const location = await shared.boundingBox()
  await shared.click()
  await expect(page.getByRole('link', { name: 'Open photo sent by Limon' })).toBeVisible()
  await page.getByRole('link', { name: 'Open photo sent by Karpuz' }).click()
  const viewer = page.getByRole('dialog', { name: 'Photo' })
  await expect(viewer.getByText('2 / 3')).toBeVisible()
  const path = new URL(page.url()).pathname
  await page.goBack()
  await expect(viewer).toBeHidden()

  // Visiting another globe from the desktop shell must leave the earlier camera alone.
  await page.setViewportSize({ width: 1100, height: 844 })
  await page.getByRole('link', { name: 'Globe', exact: true }).click()
  await globe.press('ArrowRight')
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(path + '$'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Globe' }).click()
  await expect(shared).toBeVisible()
  expect(await shared.boundingBox()).toEqual(location)
  await expect(page.getByRole('link', { name: 'Open photo sent by Limon' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open photo sent by Fıstık' })).toHaveCount(0)

  const listing = ownerCommand(['memory', path])
  const code = listing.stdout.match(/^([0-9a-f]{8}).*Karpuz.*\[Photo\]/m)?.[1]
  expect(code, listing.stdout).toBeDefined()
  expect(ownerCommand(['hide', path, code!]).status).toBe(0)
  await page.reload()
  await expect(page.getByRole('button', { name: '2 photos in this area' })).toBeVisible()
  await page.getByRole('button', { name: '2 photos in this area' }).click()
  await expect(page.getByRole('link', { name: /Open photo sent by/ })).toHaveCount(2)
  await expect(page.getByRole('link', { name: 'Open photo sent by Karpuz' })).toHaveCount(0)

  const hidden = ownerCommand(['hide', path, '--yes'])
  expect(hidden.status, hidden.stderr).toBe(0)
  await page.reload()
  await expect(page.getByText('No located photos yet')).toBeVisible()
})
