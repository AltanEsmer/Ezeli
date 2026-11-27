import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { makeClipExport } from '../clip-export.ts'
import { ezeliImport, fresh, freshPeople, owner, peopleFile, rows, storedChat } from './support.ts'

test('an export starting after the stored photo restores the clip at the existing message', async () => {
  const { dir, first } = await makeClipExport()
  const people = peopleFile(freshPeople())
  const chat = fresh('Partial clip export')
  const command = [dir, '--people', people, '--timezone', 'UTC', '--chat', chat, '--date-order', 'day-first']
  const chatFile = join(dir, '_chat.txt')
  const lines = readFileSync(chatFile, 'utf8').split('\n').slice(0, 3)
  const bytes = readFileSync(first)
  try {
    writeFileSync(chatFile, lines.join('\n') + '\n')
    rmSync(first)
    const initial = ezeliImport(command)
    expect(initial.status, initial.err).toBe(0)

    const savedChat = await storedChat(chat)
    expect(savedChat).toBeDefined()
    const memories = () => rows(owner.from('memories').select('id, key, at').eq('chat_id', savedChat!.id as string))
    const before = await memories()
    expect(before).toHaveLength(1)
    const memory = before[0]!
    const clips = () => rows<{ id: string; key: string; at: string; clip_path: string | null }>(
      owner.from('messages').select('id, key, at, clip_path').eq('memory_id', memory.id as string).eq('media_kind', 'video'),
    )
    const original = await clips()
    expect(original).toHaveLength(1)
    expect(original[0]!.clip_path).toBeNull()

    writeFileSync(chatFile, lines.slice(1).join('\n') + '\n')
    writeFileSync(first, bytes)
    const partial = ezeliImport(command)
    expect(partial.status, partial.err).toBe(0)
    expect(partial.out).toContain('Clips: 1 playable, 0 skipped.')
    expect(await memories()).toEqual(before)
    const restored = await clips()
    const path = restored[0]?.clip_path
    expect(path).toEqual(expect.any(String))
    expect(restored).toEqual([{ ...original[0], clip_path: path }])
    const downloaded = await owner.storage.from('clips').download(path!)
    expect(downloaded.error).toBeNull()
    expect(downloaded.data?.type).toBe('video/mp4')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 60_000)
