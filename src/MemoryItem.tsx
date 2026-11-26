import { type MouseEvent, type RefObject, createContext, memo, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { formatDate, formatNameParts, language, t } from './i18n.ts'
import { type MemoryCard, signedLink } from './memories.ts'
import type { SearchJump } from './searchMatch.tsx'
import { memoryPath, navigate, opened } from './route.ts'

type Photo = MemoryCard['photos'][number]

// `listName` is what the memory screen calls this list in its back link (none: "All memories").
export const SearchQuery = createContext('')
export const ListName = createContext<string | undefined>(undefined)

// A memory on a list: the timeline, a person's page and search results all draw it with this.
// The whole memory is one link. Narrow: one block of photos with the words under it. Wide: a row,
// the words in a column on the left and the photos on the right at one height. Its shape never
// depends on whether photos have loaded, and photos are only held while it is near the screen.
// `lang` is only here so that a change of language draws the memory again.
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
            <p className="mi-line" role="blockquote" dir="auto" lang="tr">
              {`“${match ? quote : cutLine(quote)}”`}
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

// A photo's own shape, kept within reason so one panorama cannot take a whole row.
const shape = (photo: Photo) => Math.min(3, Math.max(0.4, photo.width / photo.height))

// Narrow: the block of one memory. One photo is as wide as it is (up to 1.6 to 1, never tall),
// four or more are two by two, two and three sit in a block of 1.6 to 1.
const blockShape = (memory: MemoryCard) => (memory.photos.length === 1 ? Math.min(1.6, Math.max(1, shape(memory.photos[0]!))) : memory.photos.length >= 4 ? 1.4 : 1.6)

// Wide: the photos in one row at a set height, each at its own shape. When all of them nearly fit,
// the row gives up some height to show them all (down to LOWEST); otherwise it shows as many as
// fit and one more cut to what is left of the row (or, when little is left, the last one grows to
// fill it), so the row is always full, and the last carries "+N". One photo wider than the row fills it.
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
  // A first photo that is wider than the row alone fills it too, cropped around its centre.
  const fill = fits < photos.length || used > width
  const extra = fill && width - used - GAP >= LEAST
  return { photos: photos.slice(0, Math.max(1, fits + (extra ? 1 : 0))), height: ROW, fill }
}

// The place of one photo: it holds its shape while the photo loads, and when it fails to load. The
// photo fades in when it has loaded. With `ratio` it is a box of that shape; without, it fills its cell.
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

// Links for the given small photos, once they are signed. An empty list lets the photos go.
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

// Wide is a window of 900 px or more: the same rule as the stylesheets' `min-width: 900px`. A memory
// reads it because wide shows a different number of photos, not only a different layout.
const wideQuery = typeof matchMedia === 'function' ? matchMedia('(min-width: 900px)') : undefined
export const useWide = () =>
  useSyncExternalStore(
    (listen) => {
      wideQuery?.addEventListener('change', listen)
      return () => wideQuery?.removeEventListener('change', listen)
    },
    () => wideQuery?.matches ?? false,
  )

// The width of an element, kept up to date, 0 until it is measured.
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
