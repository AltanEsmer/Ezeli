import { expect, test } from '@playwright/test'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
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
