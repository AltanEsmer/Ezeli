import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { language, t } from './i18n.ts'
import { Memory, useNear } from './Memories.tsx'
import type { MemoryCard } from './memories.ts'
import { takeLastViewed, toTimeline } from './route.ts'
import { supabase } from './supabase.ts'

const PAGE = 20
// A friend typing is searched for once they pause, not at every letter.
const PAUSE_MS = 350

type State =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'failed' }
  | { status: 'ready'; items: MemoryCard[]; more: boolean; busy: boolean; pageFailed: boolean }

// What was searched and found last, kept while the friend looks at a result, so coming back shows
// the same results. It lives only in the page (never in storage or the address): reloading, or
// opening the search screen afresh, starts empty.
let saved: { text: string; items: MemoryCard[]; more: boolean } | null = null

// One page of results after the cursor, newest first. Null when the request failed.
async function fetchPage(words: string, after: MemoryCard | undefined): Promise<MemoryCard[] | null> {
  const found = await supabase.rpc('search_memories', { p_query: words, p_at: after?.local_at ?? null, p_key: after?.key ?? null, p_limit: PAGE })
  return found.error ? null : (found.data as MemoryCard[])
}

// The search screen: one box, and the memories it finds drawn as on the timeline, newest first,
// a page at a time.
export function Search({ onSessionLost }: { onSessionLost: () => void }) {
  // Coming back from a result: the box, the results and the place are what they were.
  const [back] = useState(() => {
    const key = takeLastViewed()
    if (!key) saved = null
    return saved && key ? { ...saved, key } : null
  })
  const [text, setText] = useState(back?.text ?? '')
  const [state, setState] = useState<State>(back ? { status: 'ready', items: back.items, more: back.more, busy: false, pageFailed: false } : { status: 'idle' })
  const list = useRef<HTMLDivElement>(null)
  const timer = useRef(0)
  // A new search makes whatever is still on its way stale.
  const generation = useRef(0)
  const searched = useRef(back?.text.trim().split(/\s+/).join(' ') ?? '')
  const ready = state.status === 'ready' ? state : null

  useLayoutEffect(() => {
    if (!back) return
    const cards = [...(list.current?.querySelectorAll<HTMLElement>('[data-key]') ?? [])]
    cards.find((card) => card.dataset.key === back.key)?.scrollIntoView({ block: 'center' })
  }, [back])
  useEffect(() => () => clearTimeout(timer.current), [])

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
      const words = typed.trim().split(/\s+/).join(' ')
      if (!force && words === searched.current) return
      searched.current = words
      const mine = (generation.current += 1)
      saved = null
      if (!words) return setState({ status: 'idle' })
      setState({ status: 'searching' })
      const items = await fetchPage(words, undefined)
      if (mine !== generation.current) return
      if (!items) return setState({ status: 'failed' })
      if (items.length === 0 && (await sessionEnded())) return
      if (mine !== generation.current) return
      saved = { text: typed, items, more: items.length === PAGE }
      setState({ status: 'ready', items, more: items.length === PAGE, busy: false, pageFailed: false })
    },
    [sessionEnded],
  )

  const more = useCallback(async () => {
    if (!ready) return
    const mine = generation.current
    const words = searched.current
    setState({ ...ready, busy: true, pageFailed: false })
    const page = await fetchPage(words, ready.items.at(-1))
    if (mine !== generation.current) return
    if (!page) return setState({ ...ready, busy: false, pageFailed: true })
    const items = [...ready.items, ...page]
    saved = { text, items, more: page.length === PAGE }
    setState({ status: 'ready', items, more: page.length === PAGE, busy: false, pageFailed: false })
  }, [ready, text])

  const type = (value: string) => {
    setText(value)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void run(value), PAUSE_MS)
  }

  return (
    <main className="page search">
      <header className="top">
        <button className="back hand" onClick={toTimeline}>
          <span aria-hidden="true">← </span>
          {t.allMemories}
        </button>
      </header>

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
      {ready && ready.items.length === 0 && (
        <section className="empty">
          <h2 className="hand">{t.nothingFound}</h2>
          <p>{t.nothingFoundBody}</p>
        </section>
      )}
      {ready && ready.items.length > 0 && (
        <div className="memories" ref={list}>
          <Results items={ready.items} more={ready.more} busy={ready.busy} failed={ready.pageFailed} onMore={() => void more()} />
        </div>
      )}
    </main>
  )
}

// The memories found, and the end of the list: while it is near the screen and there is more, the
// next page is fetched. It says so while loading, and when that failed, with a way to try again.
function Results(props: { items: MemoryCard[]; more: boolean; busy: boolean; failed: boolean; onMore: () => void }) {
  const end = useRef<HTMLDivElement>(null)
  const near = useNear(end)
  const { more, busy, failed, onMore } = props
  useEffect(() => {
    if (near && more && !busy && !failed) onMore()
  }, [near, more, busy, failed, props.items.length, onMore])
  return (
    <>
      <div className="mlist found">
        {props.items.map((memory, i) => (
          <Memory key={memory.id} memory={memory} index={i} lang={language} />
        ))}
      </div>
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
