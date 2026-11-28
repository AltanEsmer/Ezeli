import { spawn } from 'node:child_process'
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test } from 'vitest'
import { makeClipExport } from '../clip-export.ts'
import { ezeli, ezeliImport, fresh, freshPeople, owner, peopleFile, rows, signedInAs, stack, storedChat } from './support.ts'

test('a hidden WhatsApp clip stays hidden when its export position shifts', async () => {
  const { dir, first: firstFile } = await makeClipExport()
  const people = peopleFile(freshPeople())
  const chat = fresh('Same-minute clips')
  const chatFile = join(dir, '_chat.txt')
  const [photo, first, firstCaption, second, secondCaption] = readFileSync(chatFile, 'utf8').split('\n')
  const command = [dir, '--people', people, '--timezone', 'UTC', '--chat', chat, '--date-order', 'day-first']
  const reimport = (lines: (string | undefined)[]) => {
    writeFileSync(chatFile, [...lines, ''].join('\n'))
    const imported = ezeliImport(command)
    expect(imported.status, imported.err).toBe(0)
  }
  try {
    reimport([photo, first, firstCaption, second, secondCaption])
    const savedChat = await storedChat(chat)
    const [memory] = await rows<{ id: string; key: string }>(owner.from('memories').select('id, key').eq('chat_id', savedChat!.id as string))
    const videos = () => rows<{ id: string; key: string; text: string; clip_path: string | null }>(
      owner.from('messages').select('id, key, text, clip_path').eq('memory_id', memory!.id).eq('media_kind', 'video').order('seq'),
    )
    const before = await videos()
    expect(before.map((video) => video.text)).toEqual([firstCaption, secondCaption])
    const hiddenClip = before[1]!
    expect(hiddenClip.clip_path).toEqual(expect.any(String))
    const friend = await signedInAs(fresh('Clip friend'))
    const source = await friend.from('messages').select('clip_source, clip_digest').eq('id', hiddenClip.id)
    expect(source.error?.code).toBe('42501')
    const signed = await friend.storage.from('clips').createSignedUrl(hiddenClip.clip_path!, 60)
    expect(signed.error).toBeNull()
    const oldUrl = signed.data!.signedUrl
    expect((await fetch(oldUrl)).ok).toBe(true)

    const listing = ezeli(['memory', memory!.key])
    const [firstCode, secondCode] = listing.out.split('\n')
      .filter((line) => line.includes('[video]')).map((line) => line.split(/\s+/)[0])
    expect(secondCode).toEqual(hiddenClip.key.slice(0, 8))
    expect(firstCode).not.toBe(secondCode)
    const hidden = ezeli(['hide', memory!.key, secondCode!, '--yes'])
    expect(hidden.status, hidden.err).toBe(0)
    expect(await videos()).toEqual([before[0]])
    expect((await fetch(oldUrl)).ok).toBe(false)

    const renamed = second!.replace('WA0003', 'WA0009')
    copyFileSync(join(dir, 'VID-20221121-WA0003.mp4'), join(dir, 'VID-20221121-WA0009.mp4'))
    reimport([photo, first, firstCaption, renamed, secondCaption])
    expect(await videos()).toEqual([before[0]])
    expect((await fetch(oldUrl)).ok).toBe(false)

    rmSync(firstFile)
    reimport([photo, second, secondCaption, first, firstCaption])
    expect(await videos()).toEqual([before[0]])
    expect((await fetch(oldUrl)).ok).toBe(false)

    reimport([photo, second, secondCaption])
    expect(await videos()).toEqual([])

    const replacement = second!.replace('WA0003', 'WA0004')
    reimport([photo, second, secondCaption, replacement, 'Replacement clip'])
    const [restored] = await videos()
    expect(restored).toMatchObject({ text: 'Replacement clip' })
    expect(restored!.key.slice(0, 8)).not.toBe(secondCode)
    const stale = ezeli(['hide', memory!.key, secondCode!, '--yes'])
    expect(stale.status).toBe(1)
    expect(stale.err).toContain('This memory has no item with the code')
    expect(await videos()).toEqual([restored])
    expect(restored!.clip_path).toEqual(expect.any(String))
    expect(restored!.clip_path).not.toBe(hiddenClip.clip_path)
    expect((await fetch(oldUrl)).ok).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(dirname(people), { recursive: true, force: true })
  }
}, 60_000)

test('a hide issued during a reordered clip import removes only the selected clip', async () => {
  const { dir } = await makeClipExport()
  const people = peopleFile(freshPeople())
  const chat = fresh('Clip hide during import')
  const chatFile = join(dir, '_chat.txt')
  const [photo, first, firstCaption, second, secondCaption] = readFileSync(chatFile, 'utf8').split('\n')
  const command = [dir, '--people', people, '--timezone', 'UTC', '--chat', chat, '--date-order', 'day-first']
  const write = (lines: (string | undefined)[]) => writeFileSync(chatFile, [...lines, ''].join('\n'))
  const pause = join(dir, 'paused')
  try {
    write([photo, first, firstCaption, second, secondCaption])
    const initial = ezeliImport(command)
    expect(initial.status, initial.err).toBe(0)
    const savedChat = await storedChat(chat)
    const [memory] = await rows<{ id: string; key: string }>(owner.from('memories').select('id, key').eq('chat_id', savedChat!.id as string))
    const videos = () => rows<{ key: string; text: string; clip_path: string | null }>(
      owner.from('messages').select('key, text, clip_path').eq('memory_id', memory!.id).eq('media_kind', 'video').order('seq'),
    )
    const [kept, target] = await videos()
    expect(kept?.text).toBe(firstCaption)
    expect(target?.text).toBe(secondCaption)

    write([photo, second, secondCaption, first, firstCaption])
    const running = spawn('node', ['cli/ezeli.ts', 'import', ...command], {
      env: {
        ...process.env, SUPABASE_URL: stack.apiUrl, SUPABASE_SECRET_KEY: stack.secretKey,
        EZELI_TEST_PAUSE: pause, EZELI_TEST_PAUSE_STAGE: 'before-marks',
      },
    })
    let err = ''
    running.stderr.on('data', (chunk) => (err += chunk))
    const finished = new Promise<number | null>((resolve) => running.on('close', resolve))
    try {
      await expect.poll(() => {
        try {
          readFileSync(`${pause}.ready`)
          return true
        } catch {
          return false
        }
      }, { timeout: 20_000 }).toBe(true)
      const hidden = ezeli(['hide', memory!.key, target!.key.slice(0, 8), '--yes'])
      expect(hidden.status, hidden.err).toBe(0)
      expect(await videos()).toEqual([kept])
    } finally {
      writeFileSync(`${pause}.go`, '')
      expect(await finished, err).toBe(0)
    }
    expect(await videos()).toEqual([kept])
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(dirname(people), { recursive: true, force: true })
  }
}, 60_000)

test('a clip stays hidden when a stale import is interrupted after writing clips', async () => {
  const { dir } = await makeClipExport()
  const people = peopleFile(freshPeople())
  const chat = fresh('Interrupted clip import')
  const command = [dir, '--people', people, '--timezone', 'UTC', '--chat', chat, '--date-order', 'day-first']
  const pause = join(dir, 'paused')
  const wait = async (stage: string) => {
    await expect.poll(() => {
      try { return readFileSync(`${pause}.${stage}.ready`, 'utf8') }
      catch { return null }
    }, { timeout: 20_000 }).toBe('')
  }
  try {
    const initial = ezeliImport(command)
    expect(initial.status, initial.err).toBe(0)
    const saved = await storedChat(chat)
    const [memory] = await rows<{ id: string; key: string }>(owner.from('memories').select('id, key').eq('chat_id', saved!.id as string))
    const videos = () => rows<{ key: string; clip_path: string }>(
      owner.from('messages').select('key, clip_path').eq('memory_id', memory!.id).eq('media_kind', 'video').order('seq'),
    )
    const [kept, target] = await videos()
    expect(target?.clip_path).toEqual(expect.any(String))
    const friend = await signedInAs(fresh('Interrupted clip friend'))
    const signed = await friend.storage.from('clips').createSignedUrl(target!.clip_path, 60)
    expect(signed.error).toBeNull()

    const running = spawn('node', ['cli/ezeli.ts', 'import', ...command], {
      env: {
        ...process.env, SUPABASE_URL: stack.apiUrl, SUPABASE_SECRET_KEY: stack.secretKey,
        EZELI_TEST_PAUSE: pause, EZELI_TEST_PAUSE_STAGE: 'after-photos,after-clips',
      },
    })
    const finished = new Promise<string | null>((resolve) => running.on('close', (_, signal) => resolve(signal)))
    try {
      await wait('after-photos')
      const hidden = ezeli(['hide', memory!.key, target!.key.slice(0, 8), '--yes'])
      expect(hidden.status, hidden.err).toBe(0)
      writeFileSync(`${pause}.after-photos.go`, '')
      await wait('after-clips')
    } finally {
      running.kill('SIGTERM')
      expect(await finished).toBe('SIGTERM')
    }
    const remaining = await videos()
    expect(remaining).toContainEqual(kept)
    expect(remaining.map((video) => video.key)).not.toContain(target!.key)
    expect((await fetch(signed.data!.signedUrl)).ok).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(dirname(people), { recursive: true, force: true })
  }
}, 60_000)
