import { useCallback, useEffect, useRef, useState } from 'react'
import { takeReturnKeys } from './route.ts'
import type { SearchMatch } from './searchMatch.tsx'
import { supabase } from './supabase.ts'

// One row of the `timeline` view: a memory with its main photos, in one request.
export type MemoryCard = {
  id: string
  // The memory's lasting key: its address is built from it.
  key: string
  at: string
  // The date as shown: the clock time in the chat's time zone. The timeline's order is this, then the key.
  local_at: string
  timezone: string
  // The month it is in, on the day it was sent in the chat's time zone: 2023-07.
  month: string
  photo_count: number
  comment_count: number
  photos: { thumb: string; width: number; height: number; by: string }[]
  senders: string[]
  // One line of the conversation, as written. Null when the memory has no text.
  line: string | null
  match?: SearchMatch | null
}

export type MonthCount = { month: string; memories: number }

// What the timeline holds is one run of the archive, in order, made of the pages fetched so far.
// It starts where the friend opened it (the newest, a month, or the memory they came back from)
// and grows at both ends as they scroll. A chunk is one page.
export type Chunk = { id: number; memories: MemoryCard[] }

export type Timeline =
  | { status: 'loading' }
  | { status: 'failed' }
  | {
      status: 'ready'
      chunks: Chunk[]
      months: MonthCount[]
      hasNewer: boolean
      hasOlder: boolean
      // What is being fetched, and what failed and can be tried again.
      busy: 'older' | 'newer' | 'jump' | null
      failed: 'older' | 'newer' | 'jump' | null
      // Says what the screen must do after this render: keep its place, or go to the opened spot.
      change: { kind: 'older' | 'newer' | 'open'; n: number; id?: number; target: Target }
    }

// Where the timeline opens: a month, a memory by its key, or the newest.
export type Target = { month: string } | { key: string } | null

const PAGE = 20

type Cursor = { at: string; key: string }
const cursorOf = (memory: MemoryCard): Cursor => ({ at: memory.local_at, key: memory.key })

// The first moment of the month after `month` (2023-07), as the clock time the order uses.
const afterMonth = (month: string): Cursor => {
  const [year, number] = month.split('-').map(Number) as [number, number]
  const next = new Date(Date.UTC(year, number, 1))
  return { at: `${next.toISOString().slice(0, 10)}T00:00:00`, key: '' }
}

// One page, in the order of the screen (newest first). Null when the request failed.
async function fetchPage(person: string | null, newer: boolean, from: Cursor | null, inclusive = false): Promise<MemoryCard[] | null> {
  const found = await supabase.rpc('timeline_page', { p_newer: newer, p_at: from?.at ?? null, p_key: from?.key ?? null, p_limit: PAGE, p_inclusive: inclusive, p_person: person })
  if (found.error) return null
  const rows = found.data as MemoryCard[]
  return newer ? rows.reverse() : rows
}

// With a person's lasting id, the timeline holds only the memories that person took part in.
export function useTimeline(onSessionLost: () => void, person: string | null = null) {
  const [timeline, setTimeline] = useState<Timeline>({ status: 'loading' })
  // The memory the friend came back from: the timeline opens around it, wherever it is.
  const [comeBack] = useState(() => takeReturnKeys(person !== null))
  const data = useRef({ chunks: [] as Chunk[], months: [] as MonthCount[], hasNewer: false, hasOlder: false })
  const running = useRef(false)
  // A new opening or a reload makes anything still on its way stale.
  const generation = useRef(0)
  const counter = useRef(0)
  const lastOpened = useRef<Target>(null)

  const commit = useCallback((patch: { busy: 'older' | 'newer' | 'jump' | null; failed?: 'older' | 'newer' | 'jump' | null; kind?: 'older' | 'newer' | 'open'; id?: number; target?: Target }) => {
    setTimeline((now) => {
      const before = now.status === 'ready' ? now.change : { kind: 'open' as const, n: 0, target: null }
      const change = patch.kind ? { kind: patch.kind, n: (counter.current += 1), id: patch.id, target: patch.target ?? null } : before
      return { status: 'ready', ...data.current, busy: patch.busy, failed: patch.failed ?? null, change }
    })
  }, [])

  // An end that came back short is the end of the archive, unless the session has ended: then
  // the reader is told by the private page, not by a list that quietly stops.
  const sessionEnded = useCallback(async () => {
    const who = await supabase.rpc('current_person')
    if (!who.error && !who.data[0]) {
      onSessionLost()
      return true
    }
    return false
  }, [onSessionLost])

  // Opens the timeline around `target`, replacing what is held.
  const open = useCallback(
    async (target: Target, first = false, fallbacks: string[] = []) => {
      const mine = (generation.current += 1)
      running.current = true
      lastOpened.current = target
      if (!first) commit({ busy: 'jump' })
      const fail = () => {
        if (mine !== generation.current) return
        running.current = false
        if (first) setTimeline({ status: 'failed' })
        else commit({ busy: null, failed: 'jump' })
      }

      let from: Cursor | null = null
      let inclusive = false
      if (target && 'key' in target) {
        const row = await supabase.from('timeline').select('local_at,key').eq('key', target.key).maybeSingle()
        if (mine !== generation.current) return
        if (row.error) return fail()
        // A memory that is gone is not an error: the timeline opens at the newest.
        if (row.data) [from, inclusive] = [{ at: row.data.local_at, key: row.data.key }, true]
      } else if (target) from = afterMonth(target.month)

      const [older, newer, months] = await Promise.all([
        fetchPage(person, false, from, inclusive),
        from ? fetchPage(person, true, from) : Promise.resolve([] as MemoryCard[]),
        first ? (person === null ? supabase.from('timeline_months').select('*') : supabase.rpc('person_months', { p_person: person })) : Promise.resolve(null),
      ])
      if (mine !== generation.current) return
      if (!older || !newer || months?.error) return fail()
      // A list that does not hold the memory (a person's, after Earlier or Later stepped onto
      // someone else's) opens at the next one remembered, if there is one.
      if (person !== null && target && 'key' in target && fallbacks.length > 0 && older[0]?.key !== target.key) {
        return open({ key: fallbacks[0]! }, first, fallbacks.slice(1))
      }
      if (older.length < PAGE && (await sessionEnded())) return
      if (mine !== generation.current) return

      const chunks: Chunk[] = [newer, older].filter((memories) => memories.length > 0).map((memories) => ({ id: (counter.current += 1), memories }))
      data.current = {
        chunks,
        months: months ? (months.data as MonthCount[]) : data.current.months,
        hasNewer: newer.length === PAGE,
        hasOlder: older.length === PAGE,
      }
      running.current = false
      commit({ busy: null, kind: 'open', target })
    },
    [commit, sessionEnded, person],
  )

  const reload = useCallback(() => {
    setTimeline({ status: 'loading' })
    void open(comeBack[0] ? { key: comeBack[0] } : null, true, comeBack.slice(1))
  }, [open, comeBack])
  useEffect(reload, [reload])

  // One more page at an end of what is held: older below, newer above.
  const grow = useCallback(
    async (end: 'older' | 'newer') => {
      const held = data.current
      if (running.current || (end === 'older' ? !held.hasOlder : !held.hasNewer)) return
      const mine = generation.current
      running.current = true
      commit({ busy: end })
      const edge = end === 'older' ? held.chunks.at(-1)!.memories.at(-1)! : held.chunks[0]!.memories[0]!
      const page = await fetchPage(person, end === 'newer', cursorOf(edge))
      if (mine !== generation.current) return
      running.current = false
      if (!page) return commit({ busy: null, failed: end })
      if (page.length < PAGE && (await sessionEnded())) return
      if (mine !== generation.current) return
      const chunk = { id: (counter.current += 1), memories: page }
      data.current = {
        ...held,
        chunks: page.length === 0 ? held.chunks : end === 'older' ? [...held.chunks, chunk] : [chunk, ...held.chunks],
        [end === 'older' ? 'hasOlder' : 'hasNewer']: page.length === PAGE,
      }
      commit({ busy: null, kind: end, id: chunk.id })
    },
    [commit, sessionEnded, person],
  )

  const retry = useCallback(() => {
    const failed = timeline.status === 'ready' ? timeline.failed : null
    if (failed === 'jump') void open(lastOpened.current)
    else if (failed) void grow(failed)
  }, [timeline, open, grow])

  return { timeline, reload, grow, retry, jump: (month: string) => void open({ month }) }
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
