import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from './i18n.ts'
import type { MemoryDetail } from './memory.ts'

// A photo full screen. The photos sit side by side in a strip that snaps one at a time, so a swipe
// is the browser's own scrolling; the buttons and the arrow keys move the same strip.
export function Viewer(props: { photos: MemoryDetail['photos']; links: Map<string, string>; relink: () => Promise<boolean>; start: number; leaving: boolean; onClose: () => void }) {
  const { photos, start, leaving } = props
  // While it fades out, a key or a press must not close it a second time.
  const onClose = () => !leaving && props.onClose()
  const strip = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(start)
  // The photo being shown and the width it was laid out at: a change of width (a phone turned)
  // is not the friend moving on, and the strip is put back on that photo here, not left to the browser.
  const held = useRef(start)
  const width = useRef(0)

  const show = (to: number) => {
    const box = strip.current
    if (!box || to < 0 || to >= photos.length) return
    box.scrollTo({ left: to * box.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  // Start on the photo that was tapped.
  useLayoutEffect(() => {
    const box = strip.current
    if (!box) return
    width.current = box.clientWidth
    box.scrollLeft = start * box.clientWidth
    const watch = new ResizeObserver(() => {
      if (box.clientWidth === width.current) return
      width.current = box.clientWidth
      box.scrollTo({ left: held.current * box.clientWidth, behavior: 'instant' })
      setIndex(held.current)
    })
    watch.observe(box)
    return () => watch.disconnect()
  }, [start])

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    dialog.current?.querySelector('button')?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
      opener?.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return onClose()
      if (event.key === 'ArrowLeft') return show(index - 1)
      if (event.key === 'ArrowRight') return show(index + 1)
      if (event.key !== 'Tab' || !dialog.current) return
      // Keep Tab inside the viewer.
      const inside = [...dialog.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const first = inside[0]!
      const last = inside[inside.length - 1]!
      if (!dialog.current.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div ref={dialog} className={`viewer fade-in${leaving ? ' out' : ''}`} role="dialog" aria-modal="true" aria-label={t.photo}>
      <div
        ref={strip}
        className="strip"
        role="list"
        aria-label={t.photos}
        onScroll={(event) => {
          const box = event.currentTarget
          // While the width has changed and the strip is not yet put back, this is not a move.
          if (box.clientWidth !== width.current) return
          held.current = Math.round(box.scrollLeft / box.clientWidth)
          setIndex(held.current)
        }}
      >
        {photos.map((photo, i) => (
          <div className="slide" role="listitem" key={photo.view}>
            <Pic src={props.links.get(photo.view)} alt={t.photoBy(photo.by)} width={photo.width} height={photo.height} relink={props.relink} loading={Math.abs(i - start) < 2 ? 'eager' : 'lazy'} />
          </div>
        ))}
      </div>
      <header>
        <p aria-live="polite">
          {index + 1} / {photos.length}
        </p>
        <button onClick={onClose}>{t.close}</button>
      </header>
      <button className="arrow prev" aria-label={t.previousPhoto} disabled={index === 0} onClick={() => show(index - 1)}>
        ←
      </button>
      <button className="arrow next" aria-label={t.nextPhoto} disabled={index === photos.length - 1} onClick={() => show(index + 1)}>
        →
      </button>
    </div>
  )
}

// A photo. When its link has run out it asks for fresh links once; when that does not help either,
// a plain placeholder of the photo's shape stands in, never the browser's broken-image icon. The
// photo fades in once it has loaded.
export function Pic(props: { src: string | undefined; alt: string; width: number; height: number; relink: () => Promise<boolean>; loading?: 'eager' | 'lazy' }) {
  // 0: the first try. 1: tried again after the fresh links arrived. Failing then is the end.
  const [attempt, setAttempt] = useState(0)
  const [on, setOn] = useState(false)
  const failed = () => {
    if (!props.src || attempt > 0) return setAttempt(2)
    void props.relink().then((ok) => setAttempt(ok ? 1 : 2))
  }
  if (attempt === 2 || !props.src) return <div className="gone" role="img" aria-label={t.photoGone} style={{ '--r': props.width / props.height } as CSSProperties} />
  // The key makes the browser ask again even when the fresh link looks the same.
  return (
    <img
      key={attempt}
      className={on ? 'pic on' : 'pic'}
      src={props.src}
      alt={props.alt}
      width={props.width}
      height={props.height}
      loading={props.loading}
      ref={(img) => {
        if (img?.complete && img.naturalWidth) setOn(true)
      }}
      onLoad={() => setOn(true)}
      onError={failed}
    />
  )
}
