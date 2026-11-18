import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { language, t } from './i18n.ts'
import { type Group, ChunkView, useNear } from './Memories.tsx'
import type { Chunk, MemoryCard } from './memories.ts'
import { takeLastViewed, toTimeline } from './route.ts'
import { supabase } from './supabase.ts'

const PAGE = 20
// The database uses this many words; the rest are left out, and the friend is told.
const MOST_WORDS = 8
// A friend typing is searched for once they pause, not at every letter.
const PAUSE_MS = 350

type State =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'failed' }
  | { status: 'ready'; chunks: Chunk[]; more: boolean; busy: boolean; pageFailed: boolean; cut: boolean }

// What was searched and found last, kept while the friend looks at a result, so coming back shows
// the same results. It lives only in the page (never in storage or the address): reloading, or
// opening the search screen afresh, starts empty.
let saved: { text: string; chunks: Chunk[]; more: boolean; cut: boolean } | null = null

// The words of what was typed that are searched: the first eight, in the order typed.
const wordsOf = (typed: string) => typed.split(/\s+/).filter(Boolean)
// Three letters or digits in a row let the database narrow by index; without one it has to walk the
// memories, which is slow when the words are rare. That is searched only on Enter, not on a pause.
const quick = (typed: string) => /[\p{L}\p{N}]{3}/u.test(wordsOf(typed).slice(0, MOST_WORDS).join(' '))

// One page of results after the cursor, newest first. Null when the request failed or was cancelled.
async function fetchPage(words: string, after: MemoryCard | undefined, signal: AbortSignal): Promise<MemoryCard[] | null> {
  const found = await supabase.rpc('search_memories', { p_query: words, p_at: after?.local_at ?? null, p_key: after?.key ?? null, p_limit: PAGE }).abortSignal(signal)
  return found.error ? null : (found.data as MemoryCard[])
}

// The search screen: one box, and the memories it finds drawn as on the timeline, newest first,
// a page at a time, with only the cards near the screen held in the page.
export function Search({ onSessionLost }: { onSessionLost: () => void }) {
  // Coming back from a result: the box, the results and the place are what they were.
  const [back] = useState(() => {
    const key = takeLastViewed()
    if (!key) saved = null
    return saved && key ? { ...saved, key } : null
  })
  const [text, setText] = useState(back?.text ?? '')
  const [state, setState] = useState<State>(back ? { status: 'ready', chunks: back.chunks, more: back.more, busy: false, pageFailed: false, cut: back.cut } : { status: 'idle' })
  const list = useRef<HTMLDivElement>(null)
  const timer = useRef(0)
  const ids = useRef(back ? Math.max(0, ...back.chunks.map((chunk) => chunk.id)) : 0)
  // A new search makes the one on its way stale: its request is cancelled, and if it answers anyway
  // (the generation says) it changes nothing.
  const generation = useRef(0)
  const request = useRef<AbortController | null>(null)
  const searched = useRef(back ? wordsOf(back.text).slice(0, MOST_WORDS).join(' ') : '')
  const ready = state.status === 'ready' ? state : null

  useLayoutEffect(() => {
    if (!back) return
    const cards = [...(list.current?.querySelectorAll<HTMLElement>('[data-key]') ?? [])]
    cards.find((card) => card.dataset.key === back.key)?.scrollIntoView({ block: 'center' })
  }, [back])
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      request.current?.abort()
    },
    [],
  )

  // An empty answer may be the end of the session (a replaced link shows nothing), not "no results".
  const sessionEnded = useCallback(async () => {
    const who = await supabase.rpc('current_person')
    if (!who.error && !who.data[0]) {
      onSessionLost()
      return true
    }
    return false
  }, [onSessionLost])

  const run = useCallback(
    async (typed: string, force = false) => {
      const all = wordsOf(typed)
      const words = all.slice(0, MOST_WORDS).join(' ')
      if (!force && words === searched.current) return
      searched.current = words
      const mine = (generation.current += 1)
      request.current?.abort()
      const controller = (request.current = new AbortController())
      saved = null
      if (!words) return setState({ status: 'idle' })
      setState({ status: 'searching' })
      const items = await fetchPage(words, undefined, controller.signal)
      if (mine !== generation.current) return
      if (!items) return setState({ status: 'failed' })
      if (items.length === 0 && (await sessionEnded())) return
      if (mine !== generation.current) return
      const chunks = items.length ? [{ id: (ids.current += 1), memories: items }] : []
      const cut = all.length > MOST_WORDS
      saved = { text: typed, chunks, more: items.length === PAGE, cut }
      setState({ status: 'ready', chunks, more: items.length === PAGE, busy: false, pageFailed: false, cut })
    },
    [sessionEnded],
  )

  const more = useCallback(async () => {
    if (!ready) return
    const mine = generation.current
    setState({ ...ready, busy: true, pageFailed: false })
    request.current?.abort()
    const controller = (request.current = new AbortController())
    const page = await fetchPage(searched.current, ready.chunks.at(-1)?.memories.at(-1), controller.signal)
    if (mine !== generation.current) return
    if (!page) return setState({ ...ready, busy: false, pageFailed: true })
    const chunks = page.length ? [...ready.chunks, { id: (ids.current += 1), memories: page }] : ready.chunks
    saved = { text, chunks, more: page.length === PAGE, cut: ready.cut }
    setState({ ...ready, chunks, more: page.length === PAGE, busy: false, pageFailed: false })
  }, [ready, text])

  const type = (value: string) => {
    setText(value)
    clearTimeout(timer.current)
    // An emptied box goes back to the hint at once; a short word waits for Enter.
    if (wordsOf(value).length === 0) void run(value)
    else if (quick(value)) timer.current = window.setTimeout(() => void run(value), PAUSE_MS)
  }

  return (
    <main className="page search">
      <header className="top">
        <button className="back hand" onClick={toTimeline}>
          <span aria-hidden="true">← </span>
          {t.allMemories}
        </button>
      </header>
      <h1 className="mdate hand">{t.search}</h1>

      <form
        className="find"
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          clearTimeout(timer.current)
          void run(text)
        }}
      >
        <input
          type="search"
          className="hand"
          aria-label={t.searchLabel}
          value={text}
          autoFocus={!back}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={200}
          onChange={(event) => type(event.target.value)}
        />
      </form>

      {state.status === 'idle' && <p className="hint">{t.searchHint}</p>}
      {state.status === 'searching' && (
        <p className="hint" role="status">
          {t.searching}
        </p>
      )}
      {state.status === 'failed' && (
        <section className="empty" role="alert">
          <h2 className="hand">{t.failedTitle}</h2>
          <p>{t.failedBody}</p>
          <button className="btn" onClick={() => void run(text, true)}>
            {t.retry}
          </button>
        </section>
      )}
      {ready?.cut && <p className="hint">{t.searchCut}</p>}
      {ready && ready.chunks.length === 0 && (
        <section className="empty">
          <h2 className="hand">{t.nothingFound}</h2>
          <p>{t.nothingFoundBody}</p>
        </section>
      )}
      {ready && ready.chunks.length > 0 && (
        <div className="memories" ref={list}>
          <Results chunks={ready.chunks} more={ready.more} busy={ready.busy} failed={ready.pageFailed} onMore={() => void more()} />
        </div>
      )}
    </main>
  )
}

// The pages found, as the timeline holds its pages: near the screen a page holds its cards, far
// away it is an empty box of the height it had. After them, the end of the list: while it is near
// the screen and there is more, the next page is fetched. It says so while loading, and when that
// failed, with a way to try again.
function Results(props: { chunks: Chunk[]; more: boolean; busy: boolean; failed: boolean; onMore: () => void }) {
  const end = useRef<HTMLDivElement>(null)
  const heights = useRef(new Map<number, number>())
  const near = useNear(end)
  const { more, busy, failed, onMore } = props
  useEffect(() => {
    if (near && more && !busy && !failed) onMore()
  }, [near, more, busy, failed, props.chunks.length, onMore])
  const rows = useMemo(
    () =>
      props.chunks.map((chunk) => {
        const groups: Group[] = []
        for (const memory of chunk.memories) {
          const last = groups.at(-1)
          if (last && last.month === memory.month) last.memories.push(memory)
          else groups.push({ month: memory.month, memories: [memory], heading: false })
        }
        return { chunk, groups }
      }),
    [props.chunks],
  )
  return (
    <>
      {rows.map(({ chunk, groups }) => (
        <ChunkView key={chunk.id} chunk={chunk} groups={groups} heights={heights.current} lang={language} />
      ))}
      <div ref={end} className="more">
        {busy && <p role="status">{t.loading}</p>}
        {failed && (
          <div role="alert">
            <p>{t.failedTitle}</p>
            <button className="btn" onClick={onMore}>
              {t.retry}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
