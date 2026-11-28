import { type ReactNode, useEffect, useRef, useState } from 'react'
import { type Language, formatDate, formatDateTime, formatNameParts, language, t } from './i18n.ts'
import { Comments } from './Comments.tsx'
import { fadeMs } from './fade.ts'
import { useWide } from './MemoryItem.tsx'
import { type MemoryDetail, useMemory } from './memory.ts'
import type { Person } from './session.ts'
import { cameFrom, follow, globePath, goBack, memoryPath, navigate, personPath, pushLayer, searchJump, takeOpeningPhoto, viewed } from './route.ts'
import { type SearchJump, marked, matchRanges, useJumpTarget } from './searchMatch.tsx'
import { Pic, Viewer } from './Viewer.tsx'

// One memory: the stage with one photo and the others as small squares, and beside or under it a
// column with the date, the conversation as plain lines, the comments and earlier and later memory.
export function MemoryPage({ memoryKey, person, onSessionLost }: { memoryKey: string; person: Person; onSessionLost: () => void }) {
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

  if (state.status === 'loading' || state.status === 'gone') return <div aria-busy="true" aria-label={t.loading} />
  if (state.status !== 'ready') {
    const missing = state.status === 'missing'
    return (
      <div className="notice">
        <p className="brand">Ezeli</p>
        <h1>{missing ? t.memoryMissingTitle : t.failedTitle}</h1>
        <p>{missing ? t.memoryMissingBody : t.failedBody}</p>
        {!missing && (
          <button className="btn" onClick={reload}>
            {t.retry}
          </button>
        )}
        <button className="btn" onClick={() => goBack('/')}>
          {t.allMemories}
        </button>
      </div>
    )
  }
  return <Memory memory={state.memory} memoryKey={memoryKey} person={person} onSessionLost={onSessionLost} links={state.links} relink={relink} />
}

function Memory({ memory, memoryKey, person, onSessionLost, links, relink }: { memory: MemoryDetail; memoryKey: string; person: Person; onSessionLost: () => void; links: Map<string, string>; relink: () => Promise<boolean> }) {
  const [jump] = useState(searchJump)
  const wide = useWide()
  const from = cameFrom()
  const [selected, setSelected] = useState(() => Math.max(0, memory.photos.findIndex((photo) => photo.message === from?.photo)))
  const [open, setOpen] = useState<number | null>(null)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<number>(undefined)
  const count = memory.photos.length
  const photo = memory.photos[selected]!
  const sentAt = (memory.messages.find((m) => m.id === photo.message)?.at ?? memory.at)

  // The full-screen view is a step in the history, so the phone's Back closes it and stays here.
  // It fades out before it goes.
  const show = (index: number) => {
    pushLayer()
    clearTimeout(timer.current)
    setLeaving(false)
    setOpen(index)
  }
  useEffect(() => {
    const opening = takeOpeningPhoto()
    const index = opening ? memory.photos.findIndex((photo) => photo.message === opening) : -1
    if (index >= 0) {
      setSelected(index)
      show(index)
    }
  }, [memory.photos])
  useEffect(() => {
    const closed = () => {
      if ((history.state as { layer?: boolean } | null)?.layer) return
      setLeaving(true)
      timer.current = window.setTimeout(() => setOpen(null), fadeMs())
    }
    window.addEventListener('popstate', closed)
    return () => {
      window.removeEventListener('popstate', closed)
      clearTimeout(timer.current)
    }
  }, [])

  // The arrow keys move between the photos on the stage, unless a key like Alt (the browser's Back) is
  // held, a box has the focus or a dialog (the full-screen photo, the menu) is open.
  useEffect(() => {
    const move = (event: KeyboardEvent) => {
      if (open !== null || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.target as Element).closest('input, textarea') || document.querySelector('[role="dialog"]')) return
      if (event.key === 'ArrowRight') setSelected((now) => Math.min(count - 1, now + 1))
      if (event.key === 'ArrowLeft') setSelected((now) => Math.max(0, now - 1))
    }
    window.addEventListener('keydown', move)
    return () => window.removeEventListener('keydown', move)
  }, [open, count])

  // Back goes to the list this memory was opened from, and says so.
  const senders = new Map(memory.photos.map((each) => [each.by, each.by_id]))
  const [before, after] = t.sentBy('\0').split('\0')
  // The stage keeps the shape of the first photo, so nothing below it moves when the photo changes.
  const shape = Math.min(1.5, Math.max(0.8, memory.photos[0]!.width / memory.photos[0]!.height))

  return (
    <div className="mem">
      <div className="mem-left">
        <button className="mem-back" onClick={() => goBack(from?.path ?? '/')}>
          <span aria-hidden="true">← </span>
          {from?.path === globePath ? t.globe : from?.name ?? t.allMemories}
        </button>
        <figure className="mem-stage">
          <button className="mem-shot" style={wide ? undefined : { aspectRatio: shape }} aria-label={t.openPhoto(String(selected + 1))} onClick={() => show(selected)}>
            <Pic key={photo.view} src={links.get(photo.view)} alt={t.photoBy(photo.by)} width={photo.width} height={photo.height} relink={relink} loading="eager" />
          </button>
          <figcaption className="mem-under">
            <span>
              <span lang="tr">{named(photo.by, photo.by_id)}</span>, {formatTime(language, sentAt, memory.timezone)}
            </span>
            {count > 1 && (
              <span>
                {selected + 1} / {count}
              </span>
            )}
          </figcaption>
        </figure>
        {count > 1 && (
          <div className="mem-thumbs" role="group" aria-label={t.photos}>
            {memory.photos.map((each, index) => (
              <button key={each.view} aria-pressed={index === selected} aria-label={t.openPhoto(String(index + 1))} onClick={() => setSelected(index)}>
                <Pic src={links.get(each.thumb)} alt={t.photoBy(each.by)} width={each.width} height={each.height} relink={relink} loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mem-col">
        <header>
          <h1>{memory.place != null
            ? formatDateTime(language, memory.at, memory.timezone)
            : formatDate(language, memory.at, memory.timezone)}</h1>
          <p className="mem-sub" lang="tr">
            {memory.place || memory.chat_name}
          </p>
          <p className="mem-sub">{t.photoCount(String(count))}</p>
          <p className="mem-sub">
            {before}
            {formatNameParts(language, [...senders.keys()]).map((part, i) => (part.name ? <span key={i} lang="tr">{named(part.text, senders.get(part.text)!)}</span> : part.text))}
            {after}
          </p>
        </header>

        <Talk jump={jump?.kind === 'message' ? jump : undefined} memory={memory} links={links} relink={relink} onPhoto={(index) => (wide ? setSelected(index) : show(index))} />

        <Comments jump={jump?.kind === 'comment' ? jump : undefined} memoryKey={memoryKey} person={person} onSessionLost={onSessionLost} />

        <nav className="mem-pn">
          {memory.before ? (
            <a href={memoryPath(memory.before)} onClick={go(memory.before)}>
              <span aria-hidden="true">← </span>
              {t.earlierMemory}
            </a>
          ) : (
            <span />
          )}
          {memory.after && (
            <a href={memoryPath(memory.after)} onClick={go(memory.after)}>
              {t.laterMemory}
              <span aria-hidden="true"> →</span>
            </a>
          )}
        </nav>
      </div>

      {open !== null && <Viewer photos={memory.photos} links={links} relink={relink} start={open} leaving={leaving} onClose={() => history.back()} />}
    </div>
  )
}

// A long conversation opens on the messages around the first photo: three before it and the ones
// after, nine in all. The rest is one press away in each direction.
function Talk({ memory, links, relink, onPhoto, jump }: { jump?: SearchJump; memory: MemoryDetail; links: Map<string, string>; relink: () => Promise<boolean>; onPhoto: (index: number) => void }) {
  const photoOf = new Map(memory.photos.map((photo, index) => [photo.message, index]))
  const total = memory.messages.length
  const first = Math.max(0, memory.messages.findIndex((m) => photoOf.has(m.id)))
  const matched = jump ? memory.messages.findIndex((message) => message.id === jump.id) : -1
  const from = Math.max(0, (matched < 0 ? first : matched) - 3)
  const [range, setRange] = useState(total <= 12 ? { from: 0, to: total } : { from, to: Math.min(total, from + 9) })

  const target = useJumpTarget(matched >= 0)

  return (
    <section className="mem-talk" aria-label={t.conversation}>
      {range.from > 0 && (
        <button className="mem-more" onClick={() => setRange({ ...range, from: 0 })}>
          {t.earlierMessages(String(range.from))}
        </button>
      )}
      {groups(memory, range.from, range.to).map((group) => (
        <div className="mem-grp" key={group.messages[0]!.id}>
          {group.day && (
            <p className="mem-day" role="heading" aria-level={3}>
              {formatDate(language, group.day, memory.timezone)}
            </p>
          )}
          <div className="mem-who">
            <span role="heading" aria-level={4} lang="tr">
              {named(group.by, group.messages[0]!.by_id)}
            </span>
            <time dateTime={group.messages[0]!.at}>{formatTime(language, group.messages[0]!.at, memory.timezone)}</time>
          </div>
          {group.messages.map((message) => {
            const index = photoOf.get(message.id)
            const photo = index === undefined ? undefined : memory.photos[index]
            const clip = message.clip ? links.get(message.clip) : undefined
            const active = jump?.id === message.id
            return (
              <div ref={active ? target : undefined} tabIndex={active ? -1 : undefined} className={photo && !message.text ? 'mem-msg solo' : 'mem-msg'} key={message.id}>
                {photo && (
                  <button className="mem-mini" aria-label={t.openPhoto(String(index! + 1))} onClick={() => onPhoto(index!)}>
                    <Pic src={links.get(photo.thumb)} alt={t.photoBy(photo.by)} width={photo.width} height={photo.height} relink={relink} loading="lazy" />
                  </button>
                )}
                {clip && <Clip src={clip} video={message.clip!.endsWith('.mp4')} relink={relink} />}
                {!photo && !clip && (!message.text || message.kind === 'video' || message.kind === 'voice') &&
                  <p className="mem-gone">{placeholder(message.kind)}</p>}
                {message.text && (
                  <p dir="auto" lang="tr">
                    {linkify(message.text, active ? jump.query : '')}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      ))}
      {range.to < total && (
        <button className="mem-more" onClick={() => setRange({ ...range, to: total })}>
          {t.laterMessages(String(total - range.to))}
        </button>
      )}
    </section>
  )
}

function Clip({ src, video, relink }: { src: string; video: boolean; relink: () => Promise<boolean> }) {
  const [attempt, setAttempt] = useState(0)
  const label = video ? t.video : t.voice
  if (attempt === 2) return <p className="mem-gone">{label}</p>
  const retry = () => {
    if (attempt > 0) return setAttempt(2)
    void relink().then((ok) => setAttempt(ok ? 1 : 2))
  }
  const props = { className: 'mem-clip', src, controls: true, preload: 'none', 'aria-label': label, onError: retry }
  return video ? <video key={attempt} {...props} playsInline /> : <audio key={attempt} {...props} />
}

// A name opens that person's page, when the owners gave the person a lasting id.
const named = (name: string, id: string | null) =>
  id ? (
    <a className="nm" href={personPath(id)} onClick={follow(personPath(id))}>
      {name}
    </a>
  ) : (
    name
  )

// Another memory replaces this one in the history, so Back still leads to the timeline.
const go = (key: string) => (event: React.MouseEvent) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  navigate(memoryPath(key), { replace: true })
}

type Group = { by: string; day: string | null; messages: MemoryDetail['messages'] }

// Messages of one sender in a row sit together; a group also starts where the day changes (in the
// chat's time zone), and says which day it is.
function groups(memory: MemoryDetail, from: number, to: number): Group[] {
  const dayOf = (moment: string) => new Intl.DateTimeFormat('en-CA', { timeZone: memory.timezone }).format(new Date(moment))
  const result: Group[] = []
  let today = dayOf(memory.at)
  for (const message of memory.messages.slice(from, to)) {
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
function linkify(text: string, query: string): ReactNode[] {
  const parts: ReactNode[] = []
  const ranges = query ? matchRanges(text, query) : []
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
    parts.push(...marked(text.slice(from, start), ranges, from))
    parts.push(
      <a key={start} href={href} target="_blank" rel="noopener noreferrer">
        {marked(shown, ranges, start)}
      </a>,
    )
    from = start + shown.length
  }
  parts.push(...marked(text.slice(from), ranges, from))
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
