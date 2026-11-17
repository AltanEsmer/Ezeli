import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.ts'

// One row of the `timeline` view: a memory with its main photos, in one request.
export type MemoryCard = {
  id: string
  at: string
  timezone: string
  // The month it is in, on the day it was sent in the chat's time zone: 2023-07.
  month: string
  photo_count: number
  comment_count: number
  photos: { thumb: string; width: number; height: number; by: string }[]
  senders: string[]
  // One line of the conversation, as written. Null when the memory has no text message.
  line: string | null
}

export type MonthCount = { month: string; memories: number }

export type Timeline =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; memories: MemoryCard[]; months: MonthCount[]; more: 'idle' | 'loading' | 'failed' | 'done' }

// Memories fetched per request as the friend scrolls, and per request while jumping far ahead.
const PAGE = 60
const JUMP_PAGE = 300

// Memories newest first, paged by date: the next page is what is older than the last one loaded.
async function fetchPage(after: MemoryCard | undefined, size: number): Promise<MemoryCard[] | null> {
  let query = supabase.from('timeline').select('*').order('at', { ascending: false }).order('id', { ascending: false }).limit(size)
  if (after) query = query.or(`at.lt.${after.at},and(at.eq.${after.at},id.lt.${after.id})`)
  const found = await query
  return found.error ? null : (found.data as MemoryCard[])
}

export function useTimeline() {
  const [timeline, setTimeline] = useState<Timeline>({ status: 'loading' })
  const loaded = useRef<MemoryCard[]>([])
  const done = useRef(false)
  const running = useRef(0)
  // Requests one after the other, so a jump never races the scroll.
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const generation = useRef(0)

  const publish = useCallback((more: 'idle' | 'loading' | 'failed' | 'done') => {
    setTimeline((now) => (now.status === 'ready' ? { ...now, memories: loaded.current, more } : now))
  }, [])

  // One page, or with `until` pages until a memory of that month is loaded (or the end is reached).
  const load = useCallback(
    (until?: string): Promise<void> => {
      const mine = generation.current
      running.current += 1
      publish('loading')
      const task = chain.current.then(async () => {
        if (mine !== generation.current) return
        const size = until ? JUMP_PAGE : PAGE
        while (!done.current && !(until && loaded.current.some((memory) => memory.month === until))) {
          const page = await fetchPage(loaded.current.at(-1), size)
          if (mine !== generation.current) return
          if (!page) return publish('failed')
          loaded.current = [...loaded.current, ...page]
          if (page.length < size) done.current = true
          if (!until) break
        }
        publish(done.current ? 'done' : 'idle')
      })
      chain.current = task.finally(() => {
        running.current -= 1
      })
      return task
    },
    [publish],
  )

  const reload = useCallback(() => {
    generation.current += 1
    loaded.current = []
    done.current = false
    setTimeline({ status: 'loading' })
    void (async () => {
      const mine = generation.current
      const [page, months] = await Promise.all([fetchPage(undefined, PAGE), supabase.from('timeline_months').select('*')])
      if (mine !== generation.current) return
      if (!page || months.error) return setTimeline({ status: 'failed' })
      loaded.current = page
      done.current = page.length < PAGE
      setTimeline({ status: 'ready', memories: page, months: months.data as MonthCount[], more: done.current ? 'done' : 'idle' })
    })()
  }, [])

  useEffect(reload, [reload])

  // The bottom of the list asks for more only when nothing is already being fetched.
  const loadMore = useCallback(() => {
    if (running.current === 0 && !done.current) void load()
  }, [load])

  // Loads (if needed) until a memory of `month` is there, so the screen can scroll to it.
  return { timeline, reload, loadMore, loadThrough: load }
}

// Photos reach the app through links that stop working after this many seconds. A link is signed
// again when a photo comes back into view after most of that time has passed.
const LINK_SECONDS = 3600
const LINK_REUSE_MS = (LINK_SECONDS - 600) * 1000

const links = new Map<string, { url: string; signedAt: number }>()
const waiting = new Map<string, ((url: string | null) => void)[]>()

// A link for one small photo. Links asked for at about the same time are signed in one request.
export function signedLink(path: string): Promise<string | null> {
  const known = links.get(path)
  if (known && Date.now() - known.signedAt < LINK_REUSE_MS) return Promise.resolve(known.url)
  return new Promise((resolve) => {
    const first = waiting.size === 0
    waiting.set(path, [...(waiting.get(path) ?? []), resolve])
    if (!first) return
    setTimeout(async () => {
      const batch = new Map(waiting)
      waiting.clear()
      const signed = await supabase.storage.from('photos').createSignedUrls([...batch.keys()], LINK_SECONDS)
      const found = new Map<string, string>()
      for (const item of signed.data ?? []) if (item.path && item.signedUrl) found.set(item.path, item.signedUrl)
      for (const [key, resolvers] of batch) {
        const url = found.get(key) ?? null
        if (url) links.set(key, { url, signedAt: Date.now() })
        for (const resolver of resolvers) resolver(url)
      }
    }, 25)
  })
}
