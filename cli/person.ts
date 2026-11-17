// Owner commands about people and their personal links.
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'

const USAGE = 'Usage: pnpm ezeli person add --name <display name> [--owner]'

// The secret key comes from the environment, never from a file in the repo.
function adminClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  const appUrl = process.env.EZELI_APP_URL
  const missing = [
    ['SUPABASE_URL', url],
    ['SUPABASE_SECRET_KEY', key],
    ['EZELI_APP_URL', appUrl],
  ].filter(([, value]) => !value)
  if (missing.length > 0 || !url || !key || !appUrl) {
    throw new Error(`Set ${missing.map(([name]) => name).join(', ')} in the environment first.`)
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return { client, appUrl: appUrl.replace(/\/+$/, '') }
}

// A reserved top-level domain: no mailbox can exist there, so no mail can ever arrive.
const loginEmail = (loginId: string) => `${loginId}@ezeli.invalid`

async function addPerson(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { name: { type: 'string' }, owner: { type: 'boolean', default: false } },
    strict: true,
  })
  const name = values.name?.trim()
  if (!name) {
    console.error(USAGE)
    return 1
  }

  const { client, appUrl } = adminClient()

  const existing = await client.from('people').select('id').eq('display_name', name).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) {
    console.error(`A person called "${name}" already exists. Display names are unique.`)
    return 1
  }

  // The secret is the password of the person's account. 32 random bytes as hex stays under
  // the 72 characters Auth accepts, and survives chat apps that cut a link at - _ or .
  const loginId = randomBytes(8).toString('hex')
  const secret = randomBytes(32).toString('hex')
  const created = await client.auth.admin.createUser({
    email: loginEmail(loginId),
    password: secret,
    email_confirm: true,
  })
  if (created.error) throw created.error

  const inserted = await client
    .from('people')
    .insert({ display_name: name, is_owner: values.owner, user_id: created.data.user.id })
  if (inserted.error) {
    await client.auth.admin.deleteUser(created.data.user.id)
    throw inserted.error
  }

  console.log(`Personal link for ${name}${values.owner ? ' (owner)' : ''}. Send it to them privately, never in the group chat:`)
  console.log(`${appUrl}/#k=${loginId}.${secret}`)
  return 0
}

export async function runPerson(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args
  try {
    if (subcommand === 'add') return await addPerson(rest)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
  console.error(USAGE)
  return 1
}
