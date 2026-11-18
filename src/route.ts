import { type MouseEvent, useSyncExternalStore } from 'react'

// The addresses of the app, kept small on purpose. `/` is the timeline and `/m/<key>` one memory,
// by the memory's lasting key, so the address survives a later import. The people and search
// screens (issues 17 and 19) add their paths in `parse`: `/people`, and `/p/<id>` for one person by
// their lasting id (the slug of the people file). Hosting must answer every path with
// index.html (vercel.json); the dev server does it already.
export type Route = { name: 'timeline' } | { name: 'memory'; key: string } | { name: 'people' } | { name: 'person'; id: string }

export const memoryPath = (key: string) => `/m/${encodeURIComponent(key)}`
export const personPath = (id: string) => `/p/${encodeURIComponent(id)}`

export function parse(pathname: string): Route {
  if (/^\/people\/?$/.test(pathname)) return { name: 'people' }
  const person = pathname.match(/^\/p\/([^/]+)\/?$/)
  if (person) {
    try {
      return { name: 'person', id: decodeURIComponent(person[1]!) }
    } catch {
      return { name: 'person', id: '' }
    }
  }
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
// Whether the last move was the browser's back or forward, not a tap on a link of the app.
let lastWasPop = false
window.addEventListener('popstate', () => {
  lastWasPop = true
})
// The state of an entry of the history counts how many screens of this app are behind it,
// so a button can tell "go back" from "this address was opened directly".
const depth = () => (history.state as { depth?: number } | null)?.depth ?? 0

// The list a memory was opened from: where Back goes, and what to call it (no name: the timeline).
// It is kept in the history entry, so it survives Earlier and Later, which replace the entry.
export type From = { path: string; name?: string }
export const cameFrom = (): From | null => (history.state as { from?: From } | null)?.from ?? null

export function navigate(path: string, options: { replace?: boolean; from?: From } = {}) {
  lastWasPop = false
  const from = options.from ?? (options.replace ? cameFrom() : null)
  if (options.replace) history.replaceState({ depth: depth(), from }, '', path)
  else history.pushState({ depth: depth() + 1, from }, '', path)
  window.dispatchEvent(new Event(CHANGED))
}

// A layer on top of a screen (the full-screen photo) is a step of its own in the history, so the
// phone's Back closes it. The address stays the same.
export function pushLayer() {
  history.pushState({ depth: depth() + 1, layer: true, from: cameFrom() }, '')
}

// Back to the timeline: the browser's own back when this app has a screen behind, else forward to it.
// A tap on a link of the app goes there without a reload; a modified tap is left to the browser.
export const follow = (path: string) => (event: MouseEvent) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  navigate(path)
}

export function goBack(fallback: string) {
  if (depth() > 0) history.back()
  else navigate(fallback)
}
export const toTimeline = () => goBack('/')

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

// Where a list should be scrolled to when the reader comes back to it: the memory they looked at
// last if it is on that list, else the memory they opened from it. So "the same place" is a
// memory, not a number of pixels or of loaded pages, and Earlier and Later (which step onto other
// memories) never lose it. Any list a memory is opened from does this: `opened` when it opens one.
let lastViewed: string | null = null
let openedKey: string | null = null
export const viewed = (key: string) => {
  lastViewed = key
}
export const opened = (key: string) => {
  openedKey = key
}
// A person's list asks for them only after going back: tapping a name in a memory must not open
// their page at that memory, and the memory stays remembered for the list behind it.
export function takeReturnKeys(onlyAfterBack = false): string[] {
  if (onlyAfterBack && !lastWasPop) return []
  const keys = [lastViewed, openedKey].filter((key): key is string => key !== null)
  lastViewed = openedKey = null
  return keys
}
