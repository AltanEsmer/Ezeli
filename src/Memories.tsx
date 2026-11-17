import { type CSSProperties, type RefObject, memo, useEffect, useMemo, useRef, useState } from 'react'
import { formatDate, formatMonth, formatNames, language, t } from './i18n.ts'
import { type MemoryCard, type MonthCount, signedLink, useTimeline } from './memories.ts'

// The memories of the timeline, newest first, under month headings: each a small stack of prints
// held by tape. More are fetched as the friend scrolls; the year tabs jump to a year or a month.
export function Memories() {
  const { timeline, reload, loadMore, loadThrough } = useTimeline()
  const [current, setCurrent] = useState<string | null>(null)
  const [jumping, setJumping] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const ready = timeline.status === 'ready' ? timeline : null

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
      setCurrent(found ?? ready.memories[0]?.month ?? null)
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
  }, [ready])

  const groups = useMemo(() => {
    const out: { month: string; memories: MemoryCard[] }[] = []
    for (const memory of ready?.memories ?? []) {
      const last = out.at(-1)
      if (last?.month === memory.month) last.memories.push(memory)
      else out.push({ month: memory.month, memories: [memory] })
    }
    return out
  }, [ready?.memories])

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
  if (timeline.memories.length === 0) return <EmptyTimeline />

  // Jumping to a month that is not loaded yet loads everything newer than it first.
  const jump = async (month: string) => {
    setJumping(true)
    await loadThrough(month)
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    list.current?.querySelector(`section[data-month="${month}"]`)?.scrollIntoView({ block: 'start' })
    setJumping(false)
  }

  return (
    <div className="memories" ref={list}>
      {groups.map((group, index) => (
        <section key={group.memories[0]!.id} className="month" data-month={group.month} aria-labelledby={`month-${index}`}>
          <h2 className="monthh hand" id={`month-${index}`}>
            {formatMonth(language, group.month)}
          </h2>
          <div className="mlist">
            {group.memories.map((memory, i) => (
              <Memory key={memory.id} memory={memory} index={i} />
            ))}
          </div>
        </section>
      ))}
      <End more={timeline.more} count={timeline.memories.length} loadMore={loadMore} />
      <YearTabs months={timeline.months} current={current} busy={jumping} onJump={(month) => void jump(month)} />
    </div>
  )
}

// The end of the list: while it is near the screen and more is waiting, the next page is fetched.
function End(props: { more: 'idle' | 'loading' | 'failed' | 'done'; count: number; loadMore: () => void }) {
  const end = useRef<HTMLDivElement>(null)
  const near = useNear(end)
  const { more, count, loadMore } = props
  useEffect(() => {
    if (near && more === 'idle') loadMore()
  }, [near, more, count, loadMore])
  return (
    <div ref={end} className="more" aria-busy={more === 'loading'}>
      {more === 'failed' && (
        <button className="btn" onClick={loadMore}>
          {t.retry}
        </button>
      )}
    </div>
  )
}

// Index tabs on the right edge: a tab per year, the open year shows its months.
function YearTabs(props: { months: MonthCount[]; current: string | null; busy: boolean; onJump: (month: string) => void }) {
  const years = useMemo(() => {
    const out = new Map<string, string[]>()
    for (const { month } of props.months) out.set(month.slice(0, 4), [...(out.get(month.slice(0, 4)) ?? []), month])
    return [...out]
  }, [props.months])

  return (
    <nav className="tabs" aria-label={t.jumpTo} aria-busy={props.busy}>
      {years.map(([year, months], i) => {
        const open = props.current?.startsWith(year) ?? false
        return (
          <div key={year} className={open ? 'tab on' : 'tab'} style={{ '--c': `var(--tape${(i % 4) + 1})` } as CSSProperties}>
            <button className="yr" aria-current={open ? 'true' : undefined} disabled={props.busy} onClick={() => props.onJump(months[0]!)}>
              {year}
            </button>
            {open &&
              months.map((month) => (
                <button
                  key={month}
                  className="mo hand"
                  aria-current={month === props.current ? 'true' : undefined}
                  aria-label={formatMonth(language, month)}
                  disabled={props.busy}
                  onClick={() => props.onJump(month)}
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

// A memory is one element, the article. Its shape never depends on whether photos have loaded:
// every print keeps its place at the photo's real shape, and photos are only held in the page
// while the memory is near the screen.
const Memory = memo(function Memory({ memory, index }: { memory: MemoryCard; index: number }) {
  const card = useRef<HTMLElement>(null)
  const near = useNear(card)
  const urls = useLinks(near ? memory.photos.map((photo) => photo.thumb) : [])
  const [front, ...behind] = memory.photos
  const date = formatDate(language, memory.at, memory.timezone)
  const line = memory.line ? cutLine(memory.line) : null
  const style = { '--tilt': `${tilts[index % tilts.length]}deg`, '--tape': tapes[index % tapes.length] } as CSSProperties

  return (
    <article className="mem" style={style} ref={card}>
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
      {line && <p className="line">{`“${line}”`}</p>}
      <p className="counts">
        <span>
          <Icon d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01" />
          {t.photoCount(memory.photo_count)}
        </span>
        <span>
          <Icon d="M4 4h16v12H9l-5 4z" />
          {t.commentCount(memory.comment_count)}
        </span>
      </p>
    </article>
  )
})

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
      {broken && alt && <span className="miss">{t.photoFailed}</span>}
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
function useNear(ref: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(false)
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
