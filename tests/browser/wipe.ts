// Runs once before the browser tests: the local Supabase holds no memories, so the tests start
// from the same place every time and the timeline of a test is only what its own import made.
// This is the local stack only (see tests/stack.ts); the tests never touch a hosted project.
import { createClient } from '@supabase/supabase-js'
import { localStack } from '../stack.ts'

export default async function wipe() {
  const stack = localStack()
  const db = createClient(stack.apiUrl, stack.secretKey, { auth: { persistSession: false } })

  // Memories, messages and photos go with their chat.
  const chats = await db.from('chats').delete().not('id', 'is', null)
  if (chats.error) throw chats.error

  const bucket = db.storage.from('photos')
  for (;;) {
    const listed = await bucket.list('', { limit: 1000 })
    if (listed.error) throw listed.error
    if (listed.data.length === 0) break
    const removed = await bucket.remove(listed.data.map((file) => file.name))
    if (removed.error) throw removed.error
  }
}
