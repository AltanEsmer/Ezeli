import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from './i18n.ts'
import type { MemoryDetail } from './memory.ts'

// A photo full screen. The photos sit side by side in a strip that snaps one at a time, so a swipe
// is the browser's own scrolling; the buttons and the arrow keys move the same strip.
export function Viewer(props: { photos: MemoryDetail['photos']; links: Map<string, string>; start: number; onClose: () => void }) {
  const { photos, start, onClose } = props
  const strip = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(start)

  const show = (to: number) => {
    const box = strip.current
    if (!box || to < 0 || to >= photos.length) return
    box.scrollTo({ left: to * box.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  // Start on the photo that was tapped.
  useLayoutEffect(() => {
    const box = strip.current
    if (box) box.scrollLeft = start * box.clientWidth
  }, [start])

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLElement>('.x')?.focus()
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
    <div ref={dialog} className="viewer" role="dialog" aria-modal="true" aria-label={t.photo}>
      <div
        ref={strip}
        className="strip"
        onScroll={(event) => {
          const box = event.currentTarget
          setIndex(Math.round(box.scrollLeft / box.clientWidth))
        }}
      >
        {photos.map((photo, i) => (
          <div className="slide" key={photo.view}>
            <img src={props.links.get(photo.view)} alt={t.photoBy(photo.by)} loading={Math.abs(i - start) < 2 ? 'eager' : 'lazy'} />
          </div>
        ))}
      </div>
      <button className="x" aria-label={t.close} onClick={onClose}>
        ×
      </button>
      <button className="arrow prev" aria-label={t.previousPhoto} disabled={index === 0} onClick={() => show(index - 1)}>
        ‹
      </button>
      <button className="arrow next" aria-label={t.nextPhoto} disabled={index === photos.length - 1} onClick={() => show(index + 1)}>
        ›
      </button>
      <p className="count hand" aria-live="polite">
        {index + 1} / {photos.length}
      </p>
    </div>
  )
}
