import { expect, test } from '@playwright/test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { clipPeople, makeClipExport } from '../clip-export.ts'
import { addPerson, fruit, ownerCommand } from './support.ts'

test('hidden finishes removing clip files when the last photo was hidden', async ({ page, request }) => {
  const { dir } = await makeClipExport()
  const caption = 'The last photo and its clips'
  try {
    const chat = join(dir, '_chat.txt')
    writeFileSync(chat, readFileSync(chat, 'utf8').replace('First clip caption', caption))
    const imported = ownerCommand(['import', dir, '--people', clipPeople, '--timezone', 'UTC', '--chat', 'Last photo'])
    expect(imported.status, imported.stderr).toBe(0)

    await page.goto(addPerson(fruit('Karpuz')))
    await page.getByRole('link', { name: 'Search', exact: true }).click()
    await page.getByRole('searchbox').fill(caption)
    await page.getByRole('article').getByRole('link').click()
    await expect(page.getByRole('region', { name: 'Conversation' }).getByText(caption)).toBeVisible()
    const memory = page.url()
    const video = page.locator('video').first()
    await expect(video).toHaveAttribute('src', /^https?:/)
    const url = (await video.getAttribute('src'))!
    expect((await request.get(url)).ok()).toBe(true)

    const listing = ownerCommand(['memory', memory])
    expect(listing.status, listing.stderr).toBe(0)
    const photoCode = listing.stdout.split('\n').find((line) => line.includes('[Photo]'))?.split(/\s+/)[0]
    expect(photoCode).toBeTruthy()
    const interrupted = ownerCommand(['hide', memory, photoCode!, '--yes'], { EZELI_TEST_FAIL: 'rows' })
    expect(interrupted.status).toBe(1)
    expect(interrupted.stderr).toContain('simulated database failure')

    const filesDown = ownerCommand(['hidden'], { EZELI_TEST_FAIL: 'files' })
    expect(filesDown.status).toBe(1)
    expect(filesDown.stderr).toContain('storage is down')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'This memory is not here' })).toBeVisible()
    expect((await request.get(url)).ok()).toBe(true)

    const recovered = ownerCommand(['hidden'])
    expect(recovered.status, recovered.stderr).toBe(0)
    expect((await request.get(url)).ok()).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
