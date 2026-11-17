import type { CSSProperties } from 'react'
import { formatDate, formatNames, language, t } from './i18n.ts'
import { type MemoryCard, useTimeline } from './memories.ts'

// The memories of the timeline, newest first: each a small stack of prints held by tape.
export function Memories() {
  const { timeline, reload } = useTimeline()

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

  return (
    <div className="memories">
      {timeline.memories.map((memory, index) => (
        <Memory key={memory.id} memory={memory} index={index} links={timeline.links} />
      ))}
    </div>
  )
}

const tilts = [-2.2, 1.6, -1, 2.4]
const tapes = ['var(--tape2)', 'var(--tape1)', 'var(--tape3)', 'var(--tape4)']

function Memory({ memory, index, links }: { memory: MemoryCard; index: number; links: Map<string, string> }) {
  const [front, ...behind] = memory.photos
  const date = formatDate(language, memory.at, memory.timezone)
  const style = { '--tilt': `${tilts[index % tilts.length]}deg`, '--tape': tapes[index % tapes.length] } as CSSProperties

  return (
    <article className="mem" style={style}>
      <div className="stack">
        {behind
          .slice()
          .reverse()
          .map((photo, i) => (
            <div key={photo.thumb} className={`mprint back back${behind.length - i}`} aria-hidden="true">
              <img src={links.get(photo.thumb)} alt="" loading="lazy" />
            </div>
          ))}
        <div className="mprint front">
          {front && (
            <img
              src={links.get(front.thumb)}
              alt={t.photoBy(front.by)}
              width={front.width}
              height={front.height}
              style={{ aspectRatio: Math.min(1.5, Math.max(0.8, front.width / front.height)) }}
              loading={index < 2 ? 'eager' : 'lazy'}
            />
          )}
          <h2 className="cap hand">{date}</h2>
        </div>
        <i className="tape" aria-hidden="true" />
      </div>
      <p className="by">{t.sentBy(formatNames(language, memory.senders))}</p>
    </article>
  )
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
