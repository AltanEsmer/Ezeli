import { spawnSync } from 'node:child_process'
import { localStack } from './stack.ts'

const stack = localStack()

// The made-up people of the tests use fruit nicknames. Display names are unique,
// so every call gets a fresh one and tests never trip over each other.
let counter = 0
export function fruit(base: string): string {
  counter += 1
  return `${base} ${Date.now().toString(36)}${process.pid.toString(36)}${counter}`
}

// Runs the real owner command, as an owner would, with the secret key in the environment.
export function ownerCommand(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('node', ['cli/ezeli.ts', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPABASE_URL: stack.apiUrl,
      SUPABASE_SECRET_KEY: stack.secretKey,
      EZELI_APP_URL: stack.appUrl,
    },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

// Creates a person with the owner command and returns the personal link it printed.
export function addPerson(name: string, options: { owner?: boolean } = {}): string {
  const result = ownerCommand(['person', 'add', '--name', name, ...(options.owner ? ['--owner'] : [])])
  if (result.status !== 0) throw new Error(`person add failed: ${result.stderr}`)
  const link = result.stdout.match(/https?:\/\/\S+/)?.[0]
  if (!link) throw new Error(`person add printed no link: ${result.stdout}`)
  return link
}

export const apiUrl = stack.apiUrl
export const publishableKey = stack.publishableKey
export const appUrl = stack.appUrl
