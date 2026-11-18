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

  // The people the import made (they have a lasting id) go with them: the people page lists
  // them, so another test suite's leftovers would show there.
  const people = await db.from('people').delete().not('slug', 'is', null)
  if (people.error) throw people.error

  // Photos are in one folder per chat, so look inside the folders too.
  const bucket = db.storage.from('photos')
  for (;;) {
    const listed = await bucket.list('', { limit: 1000 })
    if (listed.error) throw listed.error
    const paths: string[] = []
    for (const entry of listed.data) {
      if (entry.id) {
        paths.push(entry.name)
        continue
      }
      const inside = await bucket.list(entry.name, { limit: 1000 })
      if (inside.error) throw inside.error
      paths.push(...inside.data.map((file) => `${entry.name}/${file.name}`))
    }
    if (paths.length === 0) break
    const removed = await bucket.remove(paths)
    if (removed.error) throw removed.error
  }
}
