import type { SearchJump } from './searchMatch.tsx'
import { type MouseEvent, useSyncExternalStore } from 'react'

// Memory URLs use lasting keys. The host must serve index.html for app routes.
export type Route = { name: 'timeline' } | { name: 'memory'; key: string } | { name: 'people' } | { name: 'person'; id: string } | { name: 'search' } | { name: 'photo-import' } | { name: 'globe' }

export const globePath = '/globe'
export const memoryPath = (key: string) => `/m/${encodeURIComponent(key)}`
export const personPath = (id: string) => `/p/${encodeURIComponent(id)}`

export function parse(pathname: string): Route {
  if (/^\/people\/?$/.test(pathname)) return { name: 'people' }
  if (/^\/search\/?$/.test(pathname)) return { name: 'search' }
  if (/^\/globe\/?$/.test(pathname)) return { name: 'globe' }
  if (/^\/import\/?$/.test(pathname)) return { name: 'photo-import' }
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
      return { name: 'memory', key: '' }
    }
  }
  return { name: 'timeline' }
}

history.scrollRestoration = 'manual'

const CHANGED = 'ezeli:route'
let lastWasPop = false
window.addEventListener('popstate', () => {
  lastWasPop = true
})
// History depth distinguishes in-app navigation from direct links.
const depth = () => (history.state as { depth?: number } | null)?.depth ?? 0

// Store the originating list in history so it survives Earlier and Later.
export type From = { path: string; name?: string; photo?: string }
export const cameFrom = (): From | null => (history.state as { from?: From } | null)?.from ?? null

// The search destination lives in this document's history only.
const searchJumps = new Map<string, SearchJump>()
export const searchJump = () => searchJumps.get(history.state?.searchJump)

export function navigate(path: string, options: { replace?: boolean; from?: From; jump?: SearchJump } = {}) {
  lastWasPop = false
  const from = options.from ?? (options.replace ? cameFrom() : null)
  if (options.replace) history.replaceState({ depth: depth(), from }, '', path)
  else {
    const searchJump = options.jump ? crypto.randomUUID() : undefined
    if (searchJump) searchJumps.set(searchJump, options.jump!)
    // Only an opaque key goes in browser history. The signed-in screen keeps the camera in memory.
    const globeEntry = path === globePath ? crypto.getRandomValues(new Uint32Array(4)).join('-') : undefined
    history.pushState({ depth: depth() + 1, from, searchJump, openingPhoto: from?.photo, globeEntry }, '', path)
  }
  window.dispatchEvent(new Event(CHANGED))
}

// The globe opens the viewer once; returning to its memory keeps the stage on the selected photo.
export function takeOpeningPhoto(): string | undefined {
  const state = history.state as { openingPhoto?: string } | null
  const linked = location.hash.match(/^#photo=([0-9a-f-]{36})$/i)?.[1]
  const photo = state?.openingPhoto ?? linked
  if (!photo) return
  const url = location.pathname + location.search + (linked ? '' : location.hash)
  history.replaceState({ ...state, openingPhoto: undefined }, '', url)
  return photo
}

// A viewer layer shares the current URL and gets its own Back step.
export function pushLayer() {
  history.pushState({ depth: depth() + 1, layer: true, from: cameFrom(), searchJump: history.state?.searchJump }, '')
}

// Discard stale viewer layers after a full reload.
if ((history.state as { layer?: boolean } | null)?.layer) history.back()

// Leave modified clicks to the browser.
export const follow = (path: string, from?: From) => (event: MouseEvent) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  navigate(path, { from })
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

const readGlobeEntry = () => (history.state as { globeEntry?: string } | null)?.globeEntry ?? ''
export const useGlobeEntry = () => useSyncExternalStore(subscribe, readGlobeEntry)

const read = () => location.pathname
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, read)
  return parse(pathname)
}

// Restore a list by memory key, falling back to the memory that opened it.
let lastViewed: string | null = null
let openedKey: string | null = null
export const viewed = (key: string) => {
  lastViewed = key
}
export const opened = (key: string) => {
  openedKey = key
}
// Restore the person-list position only on history navigation.
export function takeReturnKeys(onlyAfterBack = false): string[] {
  if (onlyAfterBack && !lastWasPop) return []
  const keys = [lastViewed, openedKey].filter((key): key is string => key !== null)
  lastViewed = openedKey = null
  return keys
}
