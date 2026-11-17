// The secret key client the owner commands use. The key comes from the environment, never from
// a file in the repo.
import { createClient } from '@supabase/supabase-js'

export function adminClient(extra: string[] = []) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  const missing = [
    ['SUPABASE_URL', url],
    ['SUPABASE_SECRET_KEY', key],
    ...extra.map((name) => [name, process.env[name]] as const),
  ].filter(([, value]) => !value)
  if (missing.length > 0 || !url || !key) {
    throw new Error(`Set ${missing.map(([name]) => name).join(', ')} in the environment first.`)
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export type Db = ReturnType<typeof adminClient>
