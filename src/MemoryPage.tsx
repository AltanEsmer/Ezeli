import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { type Language, formatDate, language, t } from './i18n.ts'
import { type MemoryDetail, useMemory } from './memory.ts'
import { memoryPath, navigate, pushLayer, toTimeline, viewed } from './route.ts'
import { Pic, Viewer } from './Viewer.tsx'

// One memory: the date as a heading, the chat it came from as a stamp, every photo as a large
// print, and the conversation as a taped slip. The place under the conversation is left free for
// comments (issue 18).
export function MemoryPage({ memoryKey, onSessionLost }: { memoryKey: string; onSessionLost: () => void }) {
  const { state, reload, relink } = useMemory(memoryKey)
  useEffect(() => {
    viewed(memoryKey)
    window.scrollTo(0, 0)
  }, [memoryKey])

  // A replaced link: the app asks who is signed in again, and shows the private page.
  const lost = state.status === 'gone'
  useEffect(() => {
    if (lost) onSessionLost()
  }, [lost, onSessionLost])

  if (state.status === 'loading' || state.status === 'gone') return <main className="page" aria-busy="true" aria-label={t.loading} />
  if (state.status !== 'ready') {
    const missing = state.status === 'missing'
    return (
      <main className="page centered">
        <section className={`slip${missing ? '' : ' red'}`}>
          <i className="tape" aria-hidden="true" />
          <h1 className="hand">{missing ? t.memoryMissingTitle : t.failedTitle}</h1>
          <p>{missing ? t.memoryMissingBody : t.failedBody}</p>
          {!missing && (
            <button className="btn" onClick={reload}>
              {t.retry}
            </button>
          )}
          <button className="btn" onClick={toTimeline}>
            {t.allMemories}
          </button>
        </section>
      </main>
    )
  }
  return <Memory memory={state.memory} links={state.links} relink={relink} />
}

const tilts = [-1.6, 1.3, -0.8, 1.8]
const tapes = ['var(--tape2)', 'var(--tape1)', 'var(--tape3)', 'var(--tape4)']
// Names are written in a pen colour of their own; all stay dark enough on the paper.
const pens = ['#1d3c8a', '#8e2414', '#1e6e68', '#6b3fa0', '#8a5a00']
const pen = (name: string) => pens[[...name].reduce((sum, ch) => sum + ch.codePointAt(0)!, 0) % pens.length]

function Memory({ memory, links, relink }: { memory: MemoryDetail; links: Map<string, string>; relink: () => Promise<boolean> }) {
  const [open, setOpen] = useState<number | null>(null)
  // The full-screen view is a step in the history, so the phone's Back closes it and stays here.
  const show = (index: number) => {
    pushLayer()
    setOpen(index)
  }
  useEffect(() => {
    const closed = () => {
      if (!(history.state as { layer?: boolean } | null)?.layer) setOpen(null)
    }
    window.addEventListener('popstate', closed)
    return () => window.removeEventListener('popstate', closed)
  }, [])
  const photoOf = new Map(memory.photos.map((photo, index) => [photo.message, index]))

  return (
    <main className="page memory">
      <header className="top">
        <button className="back hand" onClick={toTimeline}>
          <span aria-hidden="true">← </span>
          {t.allMemories}
        </button>
      </header>

      <h1 className="mdate hand">{formatDate(language, memory.at, memory.timezone)}</h1>
      <p className="stamp chat">{memory.chat_name}</p>

      <div className="prints">
        {memory.photos.map((photo, index) => (
          <figure key={photo.view} className="mprint big" style={{ '--tilt': `${tilts[index % tilts.length]}deg`, '--tape': tapes[index % tapes.length] } as CSSProperties}>
            <i className="tape" aria-hidden="true" />
            <button aria-label={t.openPhoto(String(index + 1))} onClick={() => show(index)}>
              <Pic src={links.get(photo.view)} alt={t.photoBy(photo.by)} width={photo.width} height={photo.height} relink={relink} loading={index === 0 ? 'eager' : 'lazy'} />
            </button>
            <figcaption className="cap hand">{photo.by}</figcaption>
          </figure>
        ))}
      </div>

      <section className="slip talk" aria-label={t.conversation}>
        <i className="tape" aria-hidden="true" />
        {groups(memory).map((group) => (
          <div className="group" key={group.messages[0]!.id}>
            {group.day && <p className="day hand">{formatDate(language, group.day, memory.timezone)}</p>}
            <div className="who hand" style={{ color: pen(group.messages[0]!.by_id ?? group.by) }}>
              {group.by}
            </div>
            {group.messages.map((message) => {
              const index = photoOf.get(message.id)
              const photo = index === undefined ? undefined : memory.photos[index]
              return (
                <div className="msg" key={message.id}>
                  <div className="body">
                    {photo && (
                      <button className="small" aria-label={t.openPhoto(String(index! + 1))} onClick={() => show(index!)}>
                        <Pic src={links.get(photo.thumb)} alt={t.photoBy(photo.by)} width={photo.width} height={photo.height} relink={relink} loading="lazy" />
                      </button>
                    )}
                    {message.text ? <p dir="auto">{linkify(message.text)}</p> : !photo && <em className="ph">{placeholder(message.kind)}</em>}
                  </div>
                  <time className="at" dateTime={message.at}>
                    {formatTime(language, message.at, memory.timezone)}
                  </time>
                </div>
              )
            })}
          </div>
        ))}
      </section>

      {/* Comments go here (issue 18). */}

      <nav className="pn">
        {memory.before ? (
          <a className="btn" href={memoryPath(memory.before)} onClick={go(memory.before)}>
            <span aria-hidden="true">← </span>
            {t.earlierMemory}
          </a>
        ) : (
          <span />
        )}
        {memory.after && (
          <a className="btn" href={memoryPath(memory.after)} onClick={go(memory.after)}>
            {t.laterMemory}
            <span aria-hidden="true"> →</span>
          </a>
        )}
      </nav>

      {open !== null && <Viewer photos={memory.photos} links={links} relink={relink} start={open} onClose={() => history.back()} />}
    </main>
  )
}

// Another memory replaces this one in the history, so Back still leads to the timeline.
const go = (key: string) => (event: React.MouseEvent) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  navigate(memoryPath(key), { replace: true })
}

type Group = { by: string; day: string | null; messages: MemoryDetail['messages'] }

// Messages of one sender in a row sit together; a group also starts where the day changes (in the
// chat's time zone), and says which day it is.
function groups(memory: MemoryDetail): Group[] {
  const dayOf = (moment: string) => new Intl.DateTimeFormat('en-CA', { timeZone: memory.timezone }).format(new Date(moment))
  const result: Group[] = []
  let today = dayOf(memory.at)
  for (const message of memory.messages) {
    const day = dayOf(message.at)
    const changed = day !== today
    today = day
    const last = result[result.length - 1]
    if (last && !changed && last.by === message.by) last.messages.push(message)
    else result.push({ by: message.by, day: changed ? message.at : null, messages: [message] })
  }
  return result
}

function placeholder(kind: MemoryDetail['messages'][number]['kind']): string {
  switch (kind) {
    case 'video':
      return t.video
    case 'voice':
      return t.voice
    case 'document':
      return t.document
    case 'gif':
      return t.gif
    case 'media':
      return t.mediaNotInExport
    default:
      return t.photo
  }
}

// The time of day in the chat's own time zone, 24 hours.
function formatTime(lang: Language, moment: string, zone: string): string {
  return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone }).format(new Date(moment))
}

// Only real web addresses become links: http or https, or www., with a host that has a dot and
// no sign-in part. Text stays text (React escapes it); the link opens in a new tab with no access
// to this one and no referrer.
const ADDRESS = /(?:https?:\/\/|www\.)[^\s<>]+/gi
function linkify(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let from = 0
  for (const found of text.matchAll(ADDRESS)) {
    let shown = found[0]
    for (;;) {
      // Punctuation that ends a sentence, and a bracket that closes one, are not the address.
      const trimmed = shown.replace(/[.,;:!?'"”’]+$/, '')
      const closing = trimmed.endsWith(')') && count(trimmed, '(') < count(trimmed, ')')
      shown = closing ? trimmed.slice(0, -1) : trimmed
      if (!closing) break
    }
    const href = webAddress(shown)
    if (!href) continue
    const start = found.index!
    parts.push(text.slice(from, start))
    parts.push(
      <a key={start} href={href} target="_blank" rel="noopener noreferrer">
        {shown}
      </a>,
    )
    from = start + shown.length
  }
  parts.push(text.slice(from))
  return parts
}

const count = (text: string, char: string) => text.split(char).length - 1

function webAddress(shown: string): string | null {
  try {
    const url = new URL(/^www\./i.test(shown) ? `https://${shown}` : shown)
    const real = (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && /^[^.]+(\.[^.]+)+$/.test(url.hostname)
    return real ? url.href : null
  } catch {
    return null
  }
}
