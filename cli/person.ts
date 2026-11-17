// Owner commands about people and their personal links.
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'

const USAGE = [
  'Usage: pnpm ezeli person add --name <display name> [--owner]',
  '       pnpm ezeli person relink --name <display name>',
  '       pnpm ezeli person list',
].join('\n')

// The secret key comes from the environment, never from a file in the repo.
function adminClient({ needsAppUrl = true } = {}) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  const appUrl = process.env.EZELI_APP_URL
  const missing = [
    ['SUPABASE_URL', url],
    ['SUPABASE_SECRET_KEY', key],
    ...(needsAppUrl ? [['EZELI_APP_URL', appUrl]] : []),
  ].filter(([, value]) => !value)
  if (missing.length > 0 || !url || !key || (needsAppUrl && !appUrl)) {
    throw new Error(`Set ${missing.map(([name]) => name).join(', ')} in the environment first.`)
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return { client, appUrl: (appUrl ?? '').replace(/\/+$/, '') }
}

// A reserved top-level domain: no mailbox can exist there, so no mail can ever arrive.
const loginEmail = (loginId: string) => `${loginId}@ezeli.invalid`

function newCredentials() {
  return { loginId: randomBytes(8).toString('hex'), secret: randomBytes(32).toString('hex') }
}

// parseArgs lets the last of a repeated option win silently. For a command that cuts
// someone off, that is too easy to get wrong.
function onlyOnce(values: string[] | undefined, option: string): string | undefined {
  if (values && values.length > 1) throw new Error(`Give --${option} only once.`)
  return values?.[0]
}

async function addPerson(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { name: { type: 'string', multiple: true }, owner: { type: 'boolean', default: false } },
    strict: true,
  })
  const name = onlyOnce(values.name, 'name')?.trim()
  if (!name) {
    console.error(USAGE)
    return 1
  }

  const { client, appUrl } = adminClient()

  // The import creates people before anyone gets a link: such a person has no account yet.
  const existing = await client.from('people').select('id, user_id').eq('display_name', name).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data?.user_id) {
    console.error(`"${name}" already has a personal link. Replacing a link is a separate command.`)
    return 1
  }

  // The secret is the password of the person's account. 32 random bytes as hex stays under
  // the 72 characters Auth accepts, and survives chat apps that cut a link at - _ or .
  const { loginId, secret } = newCredentials()
  const created = await client.auth.admin.createUser({
    email: loginEmail(loginId),
    password: secret,
    email_confirm: true,
  })
  if (created.error) throw created.error

  const userId = created.data.user.id
  const saved = existing.data
    ? await client.from('people').update({ user_id: userId, ...(values.owner && { is_owner: true }) }).eq('id', existing.data.id)
    : await client.from('people').insert({ display_name: name, is_owner: values.owner, user_id: userId })
  if (saved.error) {
    await client.auth.admin.deleteUser(userId)
    throw saved.error
  }

  console.log(`Personal link for ${name}${values.owner ? ' (owner)' : ''}. Send it to them privately, never in the group chat:`)
  console.log(`${appUrl}/#k=${loginId}.${secret}`)
  return 0
}

// A new login id and a new secret in one admin call. Supabase ends every session of the
// account when its password is set, so the old link and every device that used it are out.
async function relinkPerson(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { name: { type: 'string', multiple: true } }, strict: true })
  const name = onlyOnce(values.name, 'name')?.trim()
  if (!name) {
    console.error(USAGE)
    return 1
  }

  const { client, appUrl } = adminClient()
  const found = await client.from('people').select('user_id').eq('display_name', name).maybeSingle()
  if (found.error) throw found.error
  if (!found.data) {
    console.error(`There is no person called "${name}". See: pnpm ezeli person list`)
    return 1
  }
  if (!found.data.user_id) {
    console.error(`"${name}" has no personal link yet. Create one with: pnpm ezeli person add --name "${name}"`)
    return 1
  }

  const { loginId, secret } = newCredentials()
  const updated = await client.auth.admin.updateUserById(found.data.user_id, {
    email: loginEmail(loginId),
    password: secret,
    email_confirm: true,
  })
  if (updated.error) throw updated.error
  // Auth keeps the old last sign-in. Stamp the moment of replacement so the list can tell it
  // was with a link that is gone. The time is Auth's own (not this computer's), so it can be
  // compared with last_sign_in_at.
  const stamped = await client.auth.admin.updateUserById(found.data.user_id, {
    app_metadata: { link_replaced_at: updated.data.user.updated_at },
  })
  if (stamped.error) throw stamped.error

  console.log(`New personal link for ${name}. The old link and every device signed in with it are out. Send this one privately:`)
  console.log(`${appUrl}/#k=${loginId}.${secret}`)
  return 0
}

// Everyone, whether they have a link, whether they are an owner, and when they last opened it.
// Read from the sign-in records Auth already keeps (last_sign_in_at): no tracking of our own.
// Auth keeps only the latest sign-in, so this is the last opening, not the first.
async function listPeople(args: string[]): Promise<number> {
  parseArgs({ args, options: {}, strict: true })
  const { client } = adminClient({ needsAppUrl: false })

  const people = await client.from('people').select('display_name, is_owner, user_id').order('display_name')
  if (people.error) throw people.error

  const accounts = new Map<string, { opened: string | null }>()
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    for (const user of data.users) {
      // A sign-in from before the link was replaced was with a link that is gone.
      const signedIn = user.last_sign_in_at
      const replaced = user.app_metadata?.link_replaced_at as string | undefined
      const current = signedIn && (!replaced || Date.parse(signedIn) > Date.parse(replaced))
      accounts.set(user.id, { opened: current ? signedIn! : null })
    }
    if (data.users.length < 1000) break
  }

  const when = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
  const rows = people.data.map((person) => {
    const account = person.user_id ? accounts.get(person.user_id) : undefined
    return [
      person.display_name,
      account ? 'yes' : 'no',
      person.is_owner ? 'yes' : 'no',
      !account ? '-' : account.opened ? when(account.opened) : 'not yet',
    ]
  })
  const table = [['Name', 'Link', 'Owner', 'Last opened'], ...rows]
  const widths = [0, 1, 2].map((i) => Math.max(...table.map((row) => row[i]!.length)))
  for (const row of table) {
    console.log([...widths.map((w, i) => row[i]!.padEnd(w)), row[3]].join('  '))
  }
  return 0
}

export async function runPerson(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args
  try {
    if (subcommand === 'add') return await addPerson(rest)
    if (subcommand === 'relink') return await relinkPerson(rest)
    if (subcommand === 'list') return await listPeople(rest)
  } catch (error) {
    const message = (error as { message?: unknown } | null)?.message
    console.error(typeof message === 'string' && message ? message : String(error))
    return 1
  }
  console.error(USAGE)
  return 1
}
