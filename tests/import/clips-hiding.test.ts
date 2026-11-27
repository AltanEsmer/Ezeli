import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test } from 'vitest'
import { makeClipExport } from '../clip-export.ts'
import { ezeli, ezeliImport, fresh, freshPeople, owner, peopleFile, rows, signedInAs, storedChat } from './support.ts'

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
    const source = await friend.from('messages').select('clip_source').eq('id', hiddenClip.id)
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

    rmSync(firstFile)
    reimport([photo, second, secondCaption, first, firstCaption])
    expect(await videos()).toEqual([before[0]])
    expect((await fetch(oldUrl)).ok).toBe(false)

    reimport([photo, second, secondCaption])
    expect(await videos()).toEqual([])

    const replacement = second!.replace('WA0003', 'WA0004')
    reimport([photo, second, secondCaption, replacement, 'Replacement clip'])
    const [restored] = await videos()
    expect(restored).toMatchObject({ key: hiddenClip.key, text: 'Replacement clip' })
    expect(restored!.clip_path).toEqual(expect.any(String))
    expect(restored!.clip_path).not.toBe(hiddenClip.clip_path)
    expect((await fetch(oldUrl)).ok).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(dirname(people), { recursive: true, force: true })
  }
}, 60_000)
