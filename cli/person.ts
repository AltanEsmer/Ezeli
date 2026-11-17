// Owner commands about people and their personal links.
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { adminClient } from './supabase.ts'

const USAGE = 'Usage: pnpm ezeli person add --name <display name> [--owner]'

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

  const client = adminClient(['EZELI_APP_URL'])
  const appUrl = process.env.EZELI_APP_URL!.replace(/\/+$/, '')

  // The import creates people before anyone gets a link: such a person has no account yet.
  const existing = await client.from('people').select('id, user_id').eq('display_name', name).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data?.user_id) {
    console.error(`"${name}" already has a personal link. Replacing a link is a separate command.`)
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
