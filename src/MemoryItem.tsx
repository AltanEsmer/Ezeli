import { type MouseEvent, type RefObject, createContext, memo, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { formatDate, formatNameParts, language, t } from './i18n.ts'
import { type MemoryCard, signedLink } from './memories.ts'
import { type SearchJump, searchQuote } from './searchMatch.tsx'
import { memoryPath, navigate, opened } from './route.ts'

type Photo = MemoryCard['photos'][number]

// `listName` is what the memory screen calls this list in its back link (none: "All memories").
export const SearchQuery = createContext('')
export const ListName = createContext<string | undefined>(undefined)

// Timeline, person and search share a memory link with lazy-loaded photos.
export const MemoryItem = memo(function MemoryItem({ memory }: { memory: MemoryCard; lang: string }) {
  const card = useRef<HTMLElement>(null)
  const near = useNear(card)
  const listName = useContext(ListName)
  const query = useContext(SearchQuery)
  const match = query ? memory.match : null
  const quote = match?.quote ?? memory.line
  const wide = useWide()
  const [box, setBox] = useState<HTMLElement | null>(null)
  const width = useWidth(box)
  const links = useLinks(near ? memory.photos.map((photo) => photo.thumb) : [])
  const shown = wide ? strip(memory, width) : { photos: memory.photos.slice(0, 4), height: 0, fill: false }
  const rest = memory.photo_count - shown.photos.length
  const date = formatDate(language, memory.at, memory.timezone)
  const [before, after] = t.sentBy('\0').split('\0')
  const cell = (photo: Photo, i: number, fill = false) => (
    <div key={photo.thumb} className={fill ? 'mi-cell fill' : 'mi-cell'} style={wide && !fill ? { aspectRatio: shape(photo) } : undefined}>
      <Shot url={links[memory.photos.indexOf(photo)]} alt={t.photoBy(photo.by)} />
      {rest > 0 && i === shown.photos.length - 1 && <span className="mi-more">+{rest}</span>}
    </div>
  )

  return (
    <article className="mi" ref={card} data-key={memory.key}>
      <a className="mi-link" href={memoryPath(memory.key)} onClick={open(memory.key, listName, match ? { id: match.id, kind: match.kind, query } : undefined)}>
        <div className="mi-words">
          <h3 className="mi-date">{date}</h3>
          {quote && (
            <p className={match ? 'mi-line mi-match' : 'mi-line'} role="blockquote" dir="auto" lang="tr">
              {`“${match ? searchQuote(quote, query) : cutLine(quote)}”`}
            </p>
          )}
          <p className="mi-by">
            {before}
            {formatNameParts(language, memory.senders).map((part, i) => (part.name ? <span key={i} lang="tr">{part.text}</span> : part.text))}
            {after}
          </p>
          <p className="mi-counts">
            <span>{t.photoCount(String(memory.photo_count))}</span>
            {memory.comment_count > 0 && <span className="mi-has">{t.commentCount(String(memory.comment_count))}</span>}
          </p>
        </div>
        {wide ? (
          <div className="mi-box" ref={setBox} style={{ height: ROW }}>
            <div className="mi-strip" style={{ height: shown.height, width: shown.fill ? '100%' : undefined }}>
              {shown.photos.map((photo, i) => cell(photo, i, shown.fill && i === shown.photos.length - 1))}
            </div>
          </div>
        ) : (
          <div className={`mi-block n${shown.photos.length}`} style={{ aspectRatio: blockShape(memory) }}>
            {shown.photos.map((photo, i) => cell(photo, i))}
          </div>
        )}
      </a>
    </article>
  )
})

const open = (key: string, listName?: string, jump?: SearchJump) => (event: MouseEvent) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  opened(key)
  navigate(memoryPath(key), { from: { path: location.pathname, name: listName }, jump })
}

const shape = (photo: Photo) => Math.min(3, Math.max(0.4, photo.width / photo.height))

const blockShape = (memory: MemoryCard) => (memory.photos.length === 1 ? Math.min(1.6, Math.max(1, shape(memory.photos[0]!))) : memory.photos.length >= 4 ? 1.4 : 1.6)

// Shrink the row within its height limit, then crop the last visible photo to fit.
const ROW = 224
const LOWEST = 188
const GAP = 2
const LEAST = 96
function strip(memory: MemoryCard, width: number): { photos: Photo[]; height: number; fill: boolean } {
  const photos = memory.photos
  if (width === 0) return { photos: [], height: ROW, fill: false }
  const whole = (width - GAP * (photos.length - 1)) / photos.reduce((sum, photo) => sum + shape(photo), 0)
  if (memory.photo_count === photos.length && whole >= LOWEST) return { photos, height: Math.min(ROW, Math.floor(whole)), fill: false }
  let used = 0
  let fits = 0
  for (const photo of photos) {
    const next = used + shape(photo) * ROW + (fits ? GAP : 0)
    if (fits && next > width) break
    used = next
    fits++
  }
  const fill = fits < photos.length || used > width
  const extra = fill && width - used - GAP >= LEAST
  return { photos: photos.slice(0, Math.max(1, fits + (extra ? 1 : 0))), height: ROW, fill }
}

export function Shot({ url, alt = '', ratio }: { url: string | null | undefined; alt?: string; ratio?: number }) {
  const [failed, setFailed] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const broken = url != null && failed === url
  return (
    <div className={ratio ? 'shot' : 'shot fill'} data-photo="" style={ratio ? { aspectRatio: ratio } : undefined}>
      {url && !broken && (
        <img
          src={url}
          alt={alt}
          decoding="async"
          className={loaded === url ? 'on' : undefined}
          ref={(img) => {
            if (img?.complete && img.naturalWidth) setLoaded(url)
          }}
          onLoad={() => setLoaded(url)}
          onError={() => setFailed(url)}
        />
      )}
      {broken && alt && <span className="miss">{t.photoGone}</span>}
    </div>
  )
}

export function useLinks(paths: string[]): (string | null | undefined)[] {
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

// Match the stylesheets’ 900px breakpoint to choose the visible photo count.
const wideQuery = typeof matchMedia === 'function' ? matchMedia('(min-width: 900px)') : undefined
export const useWide = () =>
  useSyncExternalStore(
    (listen) => {
      wideQuery?.addEventListener('change', listen)
      return () => wideQuery?.removeEventListener('change', listen)
    },
    () => wideQuery?.matches ?? false,
  )

function useWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!element) return setWidth(0)
    const measure = () => setWidth(element.clientWidth)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(element)
    return () => watch.disconnect()
  }, [element])
  return width
}

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

export function cutLine(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const letters = [...new Intl.Segmenter().segment(flat)].map((part) => part.segment)
  if (letters.length <= max) return flat
  const head = letters.slice(0, max).join('')
  const space = head.lastIndexOf(' ')
  return `${(space > max / 2 ? head.slice(0, space) : head).replace(/[\s,.;:!?-]+$/, '')}…`
}
