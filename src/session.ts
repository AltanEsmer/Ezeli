import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.ts'

export type Person = { id: string; display_name: string; is_owner: boolean }

export type Session =
  | { status: 'loading' }
  | { status: 'private'; badLink: boolean }
  | { status: 'failed' }
  | { status: 'in'; person: Person }

// The link is  https://<app>/#k=<login id>.<secret>. Everything after # stays in the browser.
const LINK = /^#k=([0-9a-f]{16})\.([0-9a-f]{64})$/

// The secret of a link that left the address bar but has not been answered by Auth yet.
// Kept in memory only, so "try again" works after a network error or a rate limit.
let pending: { email: string; password: string } | null = null

type LinkResult = 'none' | 'signed-in' | 'refused' | 'error'

// Takes a personal link out of the address bar and signs in with it.
async function signInWithLinkInAddress(): Promise<LinkResult> {
  if (location.hash.startsWith('#k=')) {
    const found = location.hash.match(LINK)
    // Before anything else, and with replaceState, so Back does not bring the secret back.
    history.replaceState(null, '', location.pathname + location.search)
    if (!found) return 'refused'
    pending = { email: `${found[1]}@ezeli.invalid`, password: found[2]! }
  }
  if (!pending) return 'none'
  // Another person's link on this device: end the old session here first.
  await supabase.auth.signOut({ scope: 'local' })
  const { error } = await supabase.auth.signInWithPassword(pending)
  if (!error) {
    pending = null
    return 'signed-in'
  }
  // Only Auth saying the secret is wrong means the link is dead. Anything else may pass.
  if (error.code === 'invalid_credentials') {
    pending = null
    return 'refused'
  }
  return 'error'
}

async function readSession(): Promise<Session> {
  const link = await signInWithLinkInAddress()
  if (link === 'error') return { status: 'failed' }
  const refused = link === 'refused'
  const { data } = await supabase.auth.getSession()
  if (!data.session) return { status: 'private', badLink: refused }

  const { data: rows, error } = await supabase.rpc('current_person')
  if (error) return { status: 'failed' }
  const person = rows[0]
  if (!person) {
    // The token is still inside its lifetime, but the database no longer accepts it:
    // the session was ended (link replaced). Forget it on this device too.
    await supabase.auth.signOut({ scope: 'local' })
    return { status: 'private', badLink: refused }
  }
  return { status: 'in', person }
}

export function useSession() {
  const [session, setSession] = useState<Session>({ status: 'loading' })
  const latest = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++latest.current
    const next = await readSession()
    if (mine === latest.current) setSession(next)
  }, [])

  useEffect(() => {
    void reload()
    // A link opened in a tab where the app is already open only changes the fragment.
    window.addEventListener('hashchange', reload)
    return () => window.removeEventListener('hashchange', reload)
  }, [reload])

  const signOut = useCallback(async () => {
    // 'local' ends this device only. The default would sign the person out everywhere.
    await supabase.auth.signOut({ scope: 'local' })
    await reload()
  }, [reload])

  return { session, signOut, reload }
}
