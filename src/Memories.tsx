import { type CSSProperties, type MouseEvent, type RefObject, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatDate, formatMonth, formatNames, language, t } from './i18n.ts'
import { type Chunk, type MemoryCard, type MonthCount, type Timeline, signedLink, useTimeline } from './memories.ts'
import { memoryPath, navigate } from './route.ts'

type Ready = Extract<Timeline, { status: 'ready' }>
type Group = { month: string; memories: MemoryCard[]; heading: boolean }

// The gap between the parts of the timeline (the same as in the stylesheet).
const GAP = 54

// The memories of the timeline, newest first, under month headings: each a small stack of prints
// held by tape. The timeline holds a run of the archive and grows at both ends as the friend
// scrolls; the year tabs open it around a month. Only the part near the screen is in the page:
// the rest of the run keeps its height as an empty box.
export function Memories({ onSessionLost }: { onSessionLost: () => void }) {
  const { timeline, reload, grow, retry, jump } = useTimeline(onSessionLost)
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
      if (added) window.scrollBy(0, added.offsetHeight + GAP + shrunk)
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

  if (timeline.status === 'loading') return <div className="memories" aria-busy="true" aria-label={t.loading} />
  if (timeline.status === 'failed') {
    return (
      <section className="empty">
        <h1 className="hand">{t.failedTitle}</h1>
        <p>{t.failedBody}</p>
        <button className="btn" onClick={reload}>
          {t.retry}
        </button>
      </section>
    )
  }
  if (timeline.chunks.length === 0) return <EmptyTimeline />

  return (
    <div className="memories" ref={list}>
      <End side="newer" timeline={timeline} grow={grow} retry={retry} />
      {rows.map(({ chunk, groups }) => (
        <ChunkView key={chunk.id} chunk={chunk} groups={groups} heights={heights.current} lang={language} />
      ))}
      <End side="older" timeline={timeline} grow={grow} retry={retry} />
      <YearTabs months={timeline.months} current={current} busy={timeline.busy === 'jump'} onJump={jump} />
      {(timeline.busy === 'jump' || timeline.failed === 'jump') && (
        <div className="toast" role={timeline.failed === 'jump' ? 'alert' : 'status'}>
          <span>{timeline.failed === 'jump' ? t.failedTitle : t.loading}</span>
          {timeline.failed === 'jump' && (
            <button className="btn" onClick={retry}>
              {t.retry}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// One page of the run. Near the screen it holds its memories; far away it is an empty box of the
// height it had, so nothing moves and the page stays small however far the friend has gone.
// `lang` is only here so that a change of language draws the memories again.
const ChunkView = memo(function ChunkView({ chunk, groups, heights, lang }: { chunk: Chunk; groups: Group[]; heights: Map<number, number>; lang: string }) {
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
    <div ref={box} className="chunk" data-chunk={chunk.id} style={near ? undefined : { height: heights.get(chunk.id) }}>
      {near &&
        groups.map((group) => (
          <section key={group.memories[0]!.id} className="month" data-month={group.month} aria-label={group.heading ? undefined : formatMonth(language, group.month)}>
            {group.heading && (
              <h2 className="monthh hand" tabIndex={-1}>
                {formatMonth(language, group.month)}
              </h2>
            )}
            <div className="mlist">
              {group.memories.map((memory, i) => (
                <Memory key={memory.id} memory={memory} index={i} lang={lang} />
              ))}
            </div>
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
    <div ref={end} className={side === 'newer' ? 'more top' : 'more'}>
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

// Index tabs on the right edge: a tab per year, the open year shows its months. The strip
// scrolls when there are many years; a fade at an end shows that there is more that way.
function YearTabs(props: { months: MonthCount[]; current: string | null; busy: boolean; onJump: (month: string) => void }) {
  const nav = useRef<HTMLElement>(null)
  const [more, setMore] = useState({ up: false, down: false })
  const years = useMemo(() => {
    const out = new Map<string, string[]>()
    for (const { month } of props.months) out.set(month.slice(0, 4), [...(out.get(month.slice(0, 4)) ?? []), month])
    return [...out]
  }, [props.months])
  const openYear = props.current?.slice(0, 4)

  const measure = () => {
    const strip = nav.current
    if (strip) setMore({ up: strip.scrollTop > 2, down: strip.scrollTop + strip.clientHeight < strip.scrollHeight - 2 })
  }
  // The open year comes to the top of the strip, so its months are in reach.
  useLayoutEffect(() => {
    const strip = nav.current
    const open = strip?.querySelector<HTMLElement>('.tab.on')
    if (strip && open) strip.scrollTop = open.offsetTop - 4
    measure()
  }, [openYear, years])
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const jump = (month: string) => {
    if (!props.busy) props.onJump(month)
  }
  const fade = { '--fu': more.up ? '32px' : '0px', '--fd': more.down ? '32px' : '0px' } as CSSProperties

  return (
    <nav ref={nav} className="tabs" aria-label={t.jumpTo} aria-busy={props.busy} data-more-up={more.up} data-more-down={more.down} style={fade} onScroll={measure}>
      {years.map(([year, months], i) => {
        const open = year === openYear
        return (
          <div key={year} className={open ? 'tab on' : 'tab'} style={{ '--c': `var(--tape${(i % 4) + 1})` } as CSSProperties}>
            <button className="yr" aria-current={open ? 'true' : undefined} aria-disabled={props.busy} onClick={() => jump(months[0]!)}>
              {year}
            </button>
            {open &&
              months.map((month) => (
                <button
                  key={month}
                  className="mo hand"
                  aria-current={month === props.current ? 'true' : undefined}
                  aria-label={formatMonth(language, month)}
                  aria-disabled={props.busy}
                  onClick={() => jump(month)}
                >
                  {formatMonth(language, month, true)}
                </button>
              ))}
          </div>
        )
      })}
    </nav>
  )
}

const tilts = [-2.2, 1.6, -1, 2.4]
const tapes = ['var(--tape2)', 'var(--tape1)', 'var(--tape3)', 'var(--tape4)']

// A memory is one element, the article: it opens the memory. Its shape never depends on whether
// photos have loaded: every print keeps its place at the photo's real shape, and photos are only
// held in the page while the memory is near the screen.
export const Memory = memo(function Memory({ memory, index }: { memory: MemoryCard; index: number; lang: string }) {
  const card = useRef<HTMLElement>(null)
  const near = useNear(card)
  const urls = useLinks(near ? memory.photos.map((photo) => photo.thumb) : [])
  const [front, ...behind] = memory.photos
  const date = formatDate(language, memory.at, memory.timezone)
  const line = memory.line ? cutLine(memory.line) : null
  const style = { '--tilt': `${tilts[index % tilts.length]}deg`, '--tape': tapes[index % tapes.length] } as CSSProperties

  return (
    <article className="mem" style={style} ref={card} data-key={memory.key}>
      <a className="open" href={memoryPath(memory.key)} onClick={open(memory.key)}>
        <div className="stack">
          {behind
            .slice()
            .reverse()
            .map((photo, i) => (
              <div key={photo.thumb} className={`mprint back back${behind.length - i}`} aria-hidden="true">
                <Shot url={urls[memory.photos.indexOf(photo)]} />
              </div>
            ))}
          <div className="mprint front">
            {front && <Shot url={urls[0]} alt={t.photoBy(front.by)} ratio={Math.min(1.5, Math.max(0.8, front.width / front.height))} />}
            <h3 className="cap hand">{date}</h3>
          </div>
          <i className="tape" aria-hidden="true" />
        </div>
        <p className="by">{t.sentBy(formatNames(language, memory.senders))}</p>
        {line && (
          <p className="line" dir="auto">
            {`“${line}”`}
          </p>
        )}
        <p className="counts">
          <span>
            <Icon d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01" />
            {t.photoCount(String(memory.photo_count))}
          </span>
          <span>
            <Icon d="M4 4h16v12H9l-5 4z" />
            {t.commentCount(String(memory.comment_count))}
          </span>
        </p>
      </a>
    </article>
  )
})

const open = (key: string) => (event: MouseEvent) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  navigate(memoryPath(key))
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

// The place of one photo: it holds its shape while the photo loads, and when it fails to load.
function Shot({ url, alt = '', ratio }: { url: string | null | undefined; alt?: string; ratio?: number }) {
  const [failed, setFailed] = useState<string | null>(null)
  const broken = url != null && failed === url
  return (
    <div className={ratio ? 'shot' : 'shot fill'} style={ratio ? { aspectRatio: ratio } : undefined}>
      {url && !broken && <img src={url} alt={alt} decoding="async" onError={() => setFailed(url)} />}
      {broken && alt && <span className="miss">{t.photoGone}</span>}
    </div>
  )
}

// Links for the given small photos, once they are signed. An empty list lets the photos go.
function useLinks(paths: string[]): (string | null | undefined)[] {
  const key = paths.join('\n')
  const [urls, setUrls] = useState<{ key: string; urls: (string | null)[] }>({ key: '', urls: [] })
  useEffect(() => {
    if (!key) return setUrls({ key: '', urls: [] })
    let stale = false
    void Promise.all(key.split('\n').map(signedLink)).then((signed) => {
      if (!stale) setUrls({ key, urls: signed })
    })
    return () => {
      stale = true
    }
  }, [key])
  return urls.key === key ? urls.urls : []
}

// True while the element is within a screen or two of the visible part of the page.
let observer: IntersectionObserver | undefined
const listeners = new WeakMap<Element, (near: boolean) => void>()
export function useNear(ref: RefObject<Element | null>, initial = false): boolean {
  const [near, setNear] = useState(initial)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    observer ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting)
      },
      { rootMargin: '1500px 0px' },
    )
    listeners.set(element, setNear)
    observer.observe(element)
    return () => {
      observer?.unobserve(element)
      listeners.delete(element)
    }
  }, [ref])
  return near
}

// The friend's own words, cut at a word when long, never in the middle of a letter or an emoji.
export function cutLine(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const letters = [...new Intl.Segmenter().segment(flat)].map((part) => part.segment)
  if (letters.length <= max) return flat
  const head = letters.slice(0, max).join('')
  const space = head.lastIndexOf(' ')
  return `${(space > max / 2 ? head.slice(0, space) : head).replace(/[\s,.;:!?-]+$/, '')}…`
}

function EmptyTimeline() {
  return (
    <section className="empty" aria-labelledby="empty-title">
      <figure className="print">
        <i className="tape" aria-hidden="true" />
        <div className="photo" aria-hidden="true" />
        <figcaption className="hand" id="empty-title">
          {t.emptyTitle}
        </figcaption>
      </figure>
      <p>{t.emptyBody}</p>
    </section>
  )
}
