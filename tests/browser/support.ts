import { spawnSync } from 'node:child_process'
import { localStack } from '../stack.ts'

const stack = localStack()

// The made-up people of the tests use fruit nicknames. Display names are unique,
// so every call gets a fresh one and tests never trip over each other.
let counter = 0
export function fruit(base: string): string {
  counter += 1
  return `${base} ${Date.now().toString(36)}${process.pid.toString(36)}${counter}`
}

// Runs the real owner command, as an owner would, with the secret key in the environment.
export function ownerCommand(args: string[], env: Record<string, string | undefined> = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('node', ['cli/ezeli.ts', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPABASE_URL: stack.apiUrl,
      SUPABASE_SECRET_KEY: stack.secretKey,
      EZELI_APP_URL: stack.appUrl,
      ...env,
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

// A person as the import leaves them: a row with no account and no link yet. Made directly, as the
// import would also add memories, and the sign-in tests run before the timeline's data exists.
export async function addPersonWithoutAccount(name: string): Promise<void> {
  const response = await fetch(`${stack.apiUrl}/rest/v1/people`, {
    method: 'POST',
    headers: { apikey: stack.secretKey, 'content-type': 'application/json' },
    body: JSON.stringify({ display_name: name }),
  })
  if (!response.ok) throw new Error(`could not add ${name}: ${await response.text()}`)
}

export const apiUrl = stack.apiUrl
export const publishableKey = stack.publishableKey
export const secretKey = stack.secretKey
export const appUrl = stack.appUrl
