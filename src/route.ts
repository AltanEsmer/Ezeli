import { useSyncExternalStore } from 'react'

// The addresses of the app, kept small on purpose. `/` is the timeline and `/m/<key>` one memory,
// by the memory's lasting key, so the address survives a later import. `/search` is the search
// screen; what is typed there is never part of the address. The people screen (issue 17) adds its
// path in `parse`. Hosting must answer every path with
// index.html (vercel.json); the dev server does it already.
export type Route = { name: 'timeline' } | { name: 'memory'; key: string } | { name: 'search' }

export const memoryPath = (key: string) => `/m/${encodeURIComponent(key)}`

export function parse(pathname: string): Route {
  if (/^\/search\/?$/.test(pathname)) return { name: 'search' }
  const memory = pathname.match(/^\/m\/([^/]+)\/?$/)
  if (memory) {
    try {
      return { name: 'memory', key: decodeURIComponent(memory[1]!) }
    } catch {
      // A broken % escape is no memory: the screen for a memory that is not there answers it.
      return { name: 'memory', key: '' }
    }
  }
  return { name: 'timeline' }
}

// The page decides where it is scrolled to (the timeline returns to the memory that was open).
history.scrollRestoration = 'manual'

const CHANGED = 'ezeli:route'
// The state of an entry of the history counts how many screens of this app are behind it,
// so a button can tell "go back" from "this address was opened directly".
const depth = () => (history.state as { depth?: number } | null)?.depth ?? 0

export function navigate(path: string, options: { replace?: boolean } = {}) {
  if (options.replace) history.replaceState({ depth: depth() }, '', path)
  else history.pushState({ depth: depth() + 1 }, '', path)
  window.dispatchEvent(new Event(CHANGED))
}

// A layer on top of a screen (the full-screen photo) is a step of its own in the history, so the
// phone's Back closes it. The address stays the same.
export function pushLayer() {
  history.pushState({ depth: depth() + 1, layer: true }, '')
}

// Back to the timeline: the browser's own back when this app has a screen behind, else forward to it.
export function toTimeline() {
  if (depth() > 0) history.back()
  else navigate('/')
}

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener)
  window.addEventListener(CHANGED, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(CHANGED, listener)
  }
}

const read = () => location.pathname
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, read)
  return parse(pathname)
}

// The memory the reader looked at last. The timeline scrolls to it when it is shown again, so
// "the same place" is a memory, not a number of pixels or of loaded pages.
let lastViewed: string | null = null
export const viewed = (key: string) => {
  lastViewed = key
}
export function takeLastViewed(): string | null {
  const key = lastViewed
  lastViewed = null
  return key
}
