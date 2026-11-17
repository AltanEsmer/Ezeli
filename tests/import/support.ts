// Helpers for the import seam: run the real command, then look at what it stored through the
// database and the bucket, the way an owner would. The local Supabase must be running.
import { createClient } from '@supabase/supabase-js'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localStack } from '../stack.ts'

export const stack = localStack()
export const fixtures = 'tests/fixtures/whatsapp-iphone'

// A client with the secret key, which reads everything. Used to look at what was stored.
export const owner = createClient(stack.apiUrl, stack.secretKey, { auth: { persistSession: false } })

let counter = 0
// Chats and people are shared by every test on this database, so each test gets names of its own.
export function fresh(base: string): string {
  counter += 1
  return `${base} ${Date.now().toString(36)}${process.pid.toString(36)}${counter}`
}

// Runs any real owner command (memory, hide, show) with the secret key in the environment.
export function ezeli(args: string[]) {
  const result = spawnSync('node', ['cli/ezeli.ts', ...args], {
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_URL: stack.apiUrl, SUPABASE_SECRET_KEY: stack.secretKey },
  })
  return { status: result.status, out: result.stdout, err: result.stderr }
}

export function ezeliImport(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync('node', ['cli/ezeli.ts', 'import', ...args], {
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_URL: stack.apiUrl, SUPABASE_SECRET_KEY: stack.secretKey, ...env },
  })
  return { status: result.status, out: result.stdout, err: result.stderr }
}

// `cilek` is the one the people file leaves out. `ids` are the fixed ids of the people file.
export type Names = {
  karpuz: string
  limon: string
  fistik: string
  cilek: string
  ids: { karpuz: string; limon: string; fistik: string; cilek: string }
}

export function freshPeople(): Names {
  const tag = fresh('p').replace(/\s/g, '-')
  return {
    karpuz: fresh('Karpuz'),
    limon: fresh('Limon'),
    fistik: fresh('Fıstık'),
    cilek: fresh('Çilek'),
    ids: { karpuz: `karpuz-${tag}`, limon: `limon-${tag}`, fistik: `fistik-${tag}`, cilek: `cilek-${tag}` },
  }
}

// A people file for the made-up weekend chat, with names and ids no other test uses.
export function peopleFile(names: Names): string {
  const file = join(mkdtempSync(join(tmpdir(), 'ezeli-people-')), 'people.json')
  writeFileSync(
    file,
    JSON.stringify({
      people: [
        { id: names.ids.karpuz, name: names.karpuz, whatsapp: ['Karpuz K'] },
        { id: names.ids.limon, name: names.limon, whatsapp: ['Limon L', 'Limon 🌻'] },
        { id: names.ids.fistik, name: names.fistik, whatsapp: ['Fıstık F'] },
        { id: names.ids.cilek, name: names.cilek, whatsapp: ['Çilek Ç'], leftOut: true },
      ],
    }),
  )
  return file
}

// Imports an export folder (the weekend chat unless told otherwise) under a chat name.
export function importChat(chat: string, options: { people?: Names; folder?: string; timezone?: string; extra?: string[] } = {}) {
  const people = options.people ?? freshPeople()
  const result = ezeliImport([
    options.folder ?? `${fixtures}/weekend`,
    '--people',
    peopleFile(people),
    '--timezone',
    options.timezone ?? 'Europe/Istanbul',
    '--chat',
    chat,
    ...(options.extra ?? []),
  ])
  return { ...result, people }
}

export async function rows<T = Record<string, unknown>>(query: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function storedChat(name: string) {
  const found = await rows(owner.from('chats').select('*').eq('name', name))
  return found[0]
}

// Makes a person with the real owner command and signs in with the personal link it prints, as
// the app does. Returns a client that holds that person's session.
export async function signedInAs(name: string) {
  const result = spawnSync('node', ['cli/ezeli.ts', 'person', 'add', '--name', name], {
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_URL: stack.apiUrl, SUPABASE_SECRET_KEY: stack.secretKey, EZELI_APP_URL: stack.appUrl },
  })
  const link = result.stdout.match(/#k=([0-9a-f]{16})\.([0-9a-f]{64})/)
  if (!link) throw new Error(`person add printed no link: ${result.stderr}`)
  const client = createClient(stack.apiUrl, stack.publishableKey, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email: `${link[1]}@ezeli.invalid`, password: link[2]! })
  if (error) throw error
  return client
}

// A visitor: the publishable key and no session.
export const visitor = () => createClient(stack.apiUrl, stack.publishableKey, { auth: { persistSession: false } })

// A copy of the made-up weekend export in a new folder, so a test can change its photos.
export function copyOfWeekend(): string {
  const folder = mkdtempSync(join(tmpdir(), 'ezeli-export-'))
  cpSync(`${fixtures}/weekend`, folder, { recursive: true })
  return folder
}

// What is stored for a chat, counted: for comparing before and after a second import.
export async function counts(chatName: string) {
  const chat = await storedChat(chatName)
  if (!chat) return undefined
  const memories = await rows<{ id: string }>(owner.from('memories').select('id').eq('chat_id', chat.id as string))
  const ids = memories.map((m) => m.id)
  const messages = await rows(owner.from('messages').select('id').in('memory_id', ids))
  const photos = await rows(owner.from('photos').select('id').in('memory_id', ids))
  return { memories: memories.length, messages: messages.length, photos: photos.length }
}
