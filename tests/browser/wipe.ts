// Runs once before the browser tests: the local Supabase holds no memories, so the tests start
// from the same place every time and the timeline of a test is only what its own import made.
// This is the local stack only (see tests/stack.ts); the tests never touch a hosted project.
import { createClient } from '@supabase/supabase-js'
import { localStack } from '../stack.ts'

export default async function wipe() {
  const stack = localStack()
  // Deletes everything of the chats: refuse unless this is a stack on this computer.
  const host = new URL(stack.apiUrl).hostname
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Refusing to empty ${host}: the browser tests only run against a local Supabase.`)
  }
  const db = createClient(stack.apiUrl, stack.secretKey, { auth: { persistSession: false } })

  // Comments are kept apart from their memory on purpose (a memory with comments cannot be deleted).
  const comments = await db.from('comments').delete().not('id', 'is', null)
  if (comments.error) throw comments.error

  // Memories, messages and photos go with their chat.
  const chats = await db.from('chats').delete().not('id', 'is', null)
  if (chats.error) throw chats.error

  // Hidden marks outlive their chats on purpose; a clean start needs them gone too.
  const hidden = await db.from('hidden').delete().not('id', 'is', null)
  if (hidden.error) throw hidden.error

  // Every person of this local stack goes: the ones the import made and the ones the tests made
  // with `person add` (no lasting id), or they pile up run after run and the people list is cut off.
  const people = await db.from('people').delete().not('id', 'is', null)
  if (people.error) throw people.error

  // So do the sign-in users the tests made.
  for (;;) {
    const users = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (users.error) throw users.error
    if (users.data.users.length === 0) break
    for (const user of users.data.users) {
      const removed = await db.auth.admin.deleteUser(user.id)
      if (removed.error) throw removed.error
    }
  }

  // Walk subfolders so both chat imports and standalone uploads are cleared.
  const bucket = db.storage.from('photos')
  async function clearFolder(folder: string) {
    for (;;) {
      const listed = await bucket.list(folder, { limit: 1000 })
      if (listed.error) throw listed.error
      if (listed.data.length === 0) return
      const paths: string[] = []
      for (const entry of listed.data) {
        const path = folder ? `${folder}/${entry.name}` : entry.name
        if (entry.id) paths.push(path)
        else await clearFolder(path)
      }
      if (paths.length > 0) {
        const removed = await bucket.remove(paths)
        if (removed.error) throw removed.error
      }
    }
  }
  await clearFolder('')
}
