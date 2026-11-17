// Where this worktree's local Supabase is, read from the running stack itself.
// Locally each worktree has its own ports (supabase/.env); in CI the defaults apply.
import { execFileSync } from 'node:child_process'

export type Stack = {
  apiUrl: string
  publishableKey: string
  secretKey: string
  appPort: number
  appUrl: string
}

export function localStack(): Stack {
  let output: string
  try {
    output = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    throw new Error('The local Supabase is not running. Start it with: pnpm exec supabase start')
  }
  const value = (name: string): string => {
    const found = output.match(new RegExp(`^${name}="?([^"\\n]*)"?$`, 'm'))
    if (!found?.[1]) throw new Error(`supabase status did not print ${name}`)
    return found[1]
  }
  const apiUrl = value('API_URL')
  // One app port per Supabase API port, so two worktrees can run browser tests at once.
  const appPort = 5173 + (Number(new URL(apiUrl).port) - 54321)
  return {
    apiUrl,
    publishableKey: value('PUBLISHABLE_KEY'),
    secretKey: value('SECRET_KEY'),
    appPort,
    appUrl: `http://127.0.0.1:${appPort}`,
  }
}
