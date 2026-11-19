import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatMonth, language, t } from './i18n.ts'
import { type Chunk, type MemoryCard, type MonthCount, type Timeline, useTimeline } from './memories.ts'
import { ListName, MemoryItem, useNear } from './MemoryItem.tsx'

type Ready = Extract<Timeline, { status: 'ready' }>
export type Group = { month: string; memories: MemoryCard[]; heading: boolean }

// The memories of the timeline, newest first, under month headings that stay in view while their
// month scrolls. The timeline holds a run of the archive and grows at both ends as the friend
// scrolls; the list of years opens it around a month. Only the part near the screen is in the
// page: the rest of the run keeps its height as an empty box.
// With `person` (a lasting id) it holds only the memories that person took part in: the same
// timeline, filtered by the database.
// `listName` is what the memory screen calls this list in its back link (none: "All memories").
export function Memories({ onSessionLost, person = null, listName }: { onSessionLost: () => void; person?: string | null; listName?: string }) {
  const { timeline, reload, grow, retry, jump } = useTimeline(onSessionLost, person)
  const [current, setCurrent] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const heights = useRef(new Map<number, number>())
  const handled = useRef(0)
  const ready = timeline.status === 'ready' ? timeline : null

  // After the run changes: keep the place when memories are added above, go to the opened spot
  // after an opening (a month, or the memory the friend came back from).
  useLayoutEffect(() => {
    if (!ready || ready.change.n === handled.current) return
    handled.current = ready.change.n
    const { kind, id, target } = ready.change
    if (kind === 'newer') {
      const added = list.current?.querySelector<HTMLElement>(`[data-chunk="${id}"]`)
      // The chunk below it may have lost its month heading, which the new one now carries.
      const below = ready.chunks[1]
      const belowNow = below && list.current?.querySelector<HTMLElement>(`[data-chunk="${below.id}"]`)?.offsetHeight
      const belowWas = below && heights.current.get(below.id)
      const shrunk = belowNow !== undefined && belowWas !== undefined ? belowNow - belowWas : 0
      if (added) window.scrollBy(0, added.offsetHeight + shrunk)
    } else if (kind === 'open') {
      window.scrollTo(0, 0)
      if (target && 'key' in target) {
        const cards = [...(list.current?.querySelectorAll<HTMLElement>('[data-key]') ?? [])]
        cards.find((card) => card.dataset.key === target.key)?.scrollIntoView({ block: 'center' })
      } else if (target) {
        const heading = list.current?.querySelector<HTMLElement>(`section[data-month="${target.month}"] h2`)
        heading?.scrollIntoView({ block: 'start' })
        heading?.focus({ preventScroll: true })
      }
    }
  }, [ready])

  // The month whose heading is last above the top of the screen is the one the tabs show as open.
  useEffect(() => {
    if (!ready) return
    let frame = 0
    const update = () => {
      frame = 0
      let found: string | null = null
      for (const section of list.current?.querySelectorAll<HTMLElement>('section[data-month]') ?? []) {
        if (section.getBoundingClientRect().top > 140) break
        found = section.dataset.month ?? null
      }
      setCurrent(found ?? ready.chunks[0]?.memories[0]?.month ?? null)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ready?.change.n])

  const rows = useMemo(() => {
    let previous: string | null = null
    return (ready?.chunks ?? []).map((chunk) => {
      const groups: Group[] = []
      for (const memory of chunk.memories) {
        const last = groups.at(-1)
        if (last && last.month === memory.month) last.memories.push(memory)
        else groups.push({ month: memory.month, memories: [memory], heading: memory.month !== previous })
        previous = memory.month
      }
      return { chunk, groups }
    })
  }, [ready?.chunks])

  if (timeline.status === 'loading') return <div className="tl" aria-busy="true" aria-label={t.loading} />
  if (timeline.status === 'failed') {
    return (
      <section className="tl-note">
        <h1>{t.failedTitle}</h1>
        <p>{t.failedBody}</p>
        <button className="btn" onClick={reload}>
          {t.retry}
        </button>
      </section>
    )
  }
  if (timeline.chunks.length === 0) {
    return (
      <section className="tl-note">
        <h1>{t.emptyTitle}</h1>
        <p>{t.emptyBody}</p>
      </section>
    )
  }

  return (
    <ListName.Provider value={listName}>
      <div className="tl" ref={list}>
        <End side="newer" timeline={timeline} grow={grow} retry={retry} />
        <YearList months={timeline.months} current={current} busy={timeline.busy === 'jump'} onJump={jump} />
        {rows.map(({ chunk, groups }) => (
          <ChunkView key={chunk.id} chunk={chunk} groups={groups} heights={heights.current} lang={language} />
        ))}
        <End side="older" timeline={timeline} grow={grow} retry={retry} />
        {(timeline.busy === 'jump' || timeline.failed === 'jump') && (
          <div className="tl-toast" role={timeline.failed === 'jump' ? 'alert' : 'status'}>
            <span>{timeline.failed === 'jump' ? t.failedTitle : t.loading}</span>
            {timeline.failed === 'jump' && (
              <button className="btn" onClick={retry}>
                {t.retry}
              </button>
            )}
          </div>
        )}
      </div>
    </ListName.Provider>
  )
}

// One page of the run. Near the screen it holds its memories; far away it is an empty box of the
// height it had, so nothing moves and the page stays small however far the friend has gone.
// `lang` is only here so that a change of language draws the memories again.
export const ChunkView = memo(function ChunkView({ chunk, groups, heights, lang }: { chunk: Chunk; groups: Group[]; heights: Map<number, number>; lang: string }) {
  const box = useRef<HTMLDivElement>(null)
  const near = useNear(box, true)

  useLayoutEffect(() => {
    if (!near || !box.current) return
    const element = box.current
    heights.set(chunk.id, element.offsetHeight)
    const watch = new ResizeObserver(() => heights.set(chunk.id, element.offsetHeight))
    watch.observe(element)
    return () => watch.disconnect()
  }, [near, chunk.id, heights])

  return (
    <div ref={box} className="tl-chunk" data-chunk={chunk.id} style={near ? undefined : { height: heights.get(chunk.id) }}>
      {near &&
        groups.map((group) => (
          <section key={group.memories[0]!.id} data-month={group.month} aria-label={group.heading ? undefined : formatMonth(language, group.month)}>
            {group.heading && (
              <h2 className="tl-head" tabIndex={-1}>
                {formatMonth(language, group.month)}
              </h2>
            )}
            {group.memories.map((memory) => (
              <MemoryItem key={memory.id} memory={memory} lang={lang} />
            ))}
          </section>
        ))}
    </div>
  )
})

// An end of the run: while it is near the screen and there is more beyond it, the next page is
// fetched. It says so while loading, and when it failed, in one line with a way to try again.
function End(props: { side: 'newer' | 'older'; timeline: Ready; grow: (end: 'older' | 'newer') => Promise<void>; retry: () => void }) {
  const { side, timeline, grow } = props
  const end = useRef<HTMLDivElement>(null)
  const near = useNear(end)
  const more = side === 'older' ? timeline.hasOlder : timeline.hasNewer
  useEffect(() => {
    if (near && more && !timeline.busy && !timeline.failed) void grow(side)
  }, [near, more, timeline.busy, timeline.failed, timeline.change.n, side, grow])
  return (
    <div ref={end} className={side === 'newer' ? 'tl-end top' : 'tl-end'}>
      {timeline.busy === side && <p role="status">{t.loading}</p>}
      {timeline.failed === side && (
        <div role="alert">
          <p>{t.failedTitle}</p>
          <button className="btn" onClick={props.retry}>
            {t.retry}
          </button>
        </div>
      )}
    </div>
  )
}

// The years that have memories, the one in view open with its months. Wide: a list down the right
// edge. Narrow: a strip under the top bar. It scrolls when there are many years. Pressing a year
// or a month opens the timeline there.
function YearList(props: { months: MonthCount[]; current: string | null; busy: boolean; onJump: (month: string) => void }) {
  const nav = useRef<HTMLElement>(null)
  const years = useMemo(() => {
    const out = new Map<string, string[]>()
    for (const { month } of props.months) out.set(month.slice(0, 4), [...(out.get(month.slice(0, 4)) ?? []), month])
    return [...out]
  }, [props.months])
  const openYear = props.current?.slice(0, 4)

  // The open year comes to the start of the list, so its months are in reach.
  useLayoutEffect(() => {
    const list = nav.current
    const open = list?.querySelector<HTMLElement>('[data-open]')
    if (list && open) {
      list.scrollTop = open.offsetTop - 4
      list.scrollLeft = open.offsetLeft - 8
    }
  }, [openYear, years])

  const jump = (month: string) => {
    if (!props.busy) props.onJump(month)
  }

  return (
    <nav ref={nav} className="tl-years" aria-label={t.jumpTo} aria-busy={props.busy}>
      {years.map(([year, months]) => {
        const open = year === openYear
        return (
          <div key={year} data-open={open || undefined}>
            <button aria-current={open ? 'true' : undefined} aria-disabled={props.busy} onClick={() => jump(months[0]!)}>
              {year}
            </button>
            {open &&
              months.map((month) => (
                <button key={month} className="mo" aria-current={month === props.current ? 'true' : undefined} aria-label={formatMonth(language, month)} aria-disabled={props.busy} onClick={() => jump(month)}>
                  {formatMonth(language, month, true)}
                </button>
              ))}
          </div>
        )
      })}
    </nav>
  )
}
