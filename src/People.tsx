import { type CSSProperties, useCallback, useEffect, useState } from 'react'
import { formatDate, language, t } from './i18n.ts'
import { Memories, Shot, useLinks } from './Memories.tsx'
import { follow, goBack, personPath, toTimeline } from './route.ts'
import { supabase } from './supabase.ts'

// What `people_page` and `person_page` return, each in one request. Nothing but the display name,
// the lasting id and the photos a person sent.
type Listed = { id: string; name: string; photos: { thumb: string; width: number; height: number }[] }
type Moment = { at: string; timezone: string }
type Details = { id: string; name: string; photo_count: number; first: Moment | null; last: Moment | null }

type Load<T> = { status: 'loading' } | { status: 'failed' } | { status: 'missing' } | { status: 'ready'; value: T }

// Loads one thing and asks whose session this is when it comes back empty: an empty answer is also
// what a session that has ended gets, and that must show the private page, not "nobody here".
function useLoad<T>(fetch: () => PromiseLike<{ data: unknown; error: unknown }>, empty: (data: unknown) => boolean, onSessionLost: () => void, whenEmpty: 'missing' | 'ready' = 'missing') {
  const [state, setState] = useState<Load<T>>({ status: 'loading' })
  const reload = useCallback(() => {
    setState({ status: 'loading' })
    void (async () => {
      const found = await fetch()
      if (found.error) return setState({ status: 'failed' })
      if (empty(found.data)) {
        const who = await supabase.rpc('current_person')
        if (!who.error && !who.data[0]) return onSessionLost()
        return setState(whenEmpty === 'ready' ? { status: 'ready', value: found.data as T } : { status: 'missing' })
      }
      setState({ status: 'ready', value: found.data as T })
    })()
  }, [])
  useEffect(reload, [reload])
  return { state, reload }
}

const tilts = [-2.4, 1.8, -1.2, 2.6]
const tapes = ['var(--tape2)', 'var(--tape1)', 'var(--tape3)', 'var(--tape4)']

function Failed({ reload }: { reload: () => void }) {
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

// Everyone of the group: a taped slip each with the name and a few of the photos they sent, most
// recent first, laid out like prints dropped on a table.
export function PeoplePage({ onSessionLost }: { onSessionLost: () => void }) {
  const { state, reload } = useLoad<Listed[]>(
    () => supabase.rpc('people_page'),
    (data) => !Array.isArray(data) || data.length === 0,
    onSessionLost,
    'ready',
  )
  const people = state.status === 'ready' ? [...state.value].sort((a, b) => a.name.localeCompare(b.name, language)) : []
  const urls = useLinks(people.flatMap((person) => person.photos.map((photo) => photo.thumb)))
  const link = new Map(people.flatMap((person) => person.photos).map((photo, i) => [photo.thumb, urls[i]] as const))

  return (
    <div className="page">
      <header className="top">
        <button className="back hand" onClick={toTimeline}>
          <span aria-hidden="true">← </span>
          {t.allMemories}
        </button>
      </header>
      <h1 className="mdate hand">{t.people}</h1>
      {state.status === 'loading' && <div aria-busy="true" aria-label={t.loading} />}
      {state.status === 'failed' && <Failed reload={reload} />}
      {state.status === 'ready' && people.length === 0 && (
        <section className="empty">
          <h2 className="hand">{t.noPeople}</h2>
          <p>{t.emptyBody}</p>
        </section>
      )}
      {state.status === 'ready' && people.length > 0 && (
        <ul className="people" aria-label={t.people}>
          {people.map((person, i) => (
            <li key={person.id} style={{ '--tilt': `${tilts[i % tilts.length]}deg`, '--tape': tapes[i % tapes.length] } as CSSProperties}>
              <a className="pcard" aria-label={person.name} href={personPath(person.id)} onClick={follow(personPath(person.id))}>
                <i className="tape" aria-hidden="true" />
                <h2 className="hand">{person.name}</h2>
                {person.photos.length === 0 ? (
                  <p className="none">{t.noPhotos}</p>
                ) : (
                  <div className="fan">
                    {person.photos.map((photo, n) => (
                      <div key={photo.thumb} className={`mprint fan${n}`}>
                        <Shot url={link.get(photo.thumb)} ratio={Math.min(1.5, Math.max(0.8, photo.width / photo.height))} />
                      </div>
                    ))}
                  </div>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// One person: their name, when their first and latest memories are, how many photos they sent,
// and the memories they took part in as the same timeline the front page has.
export function PersonPage({ id, onSessionLost }: { id: string; onSessionLost: () => void }) {
  const { state, reload } = useLoad<Details>(
    () => supabase.rpc('person_page', { p_person: id }),
    (data) => !data,
    onSessionLost,
  )
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  const back = (
    <header className="top">
      <button className="back hand" onClick={() => goBack('/people')}>
        <span aria-hidden="true">← </span>
        {t.back}
      </button>
    </header>
  )
  if (state.status === 'loading') return <div className="page" aria-busy="true" aria-label={t.loading} />
  if (state.status === 'failed') return <div className="page">{back}<Failed reload={reload} /></div>
  if (state.status === 'missing') {
    return (
      <div className="page centered">
        <section className="slip">
          <i className="tape" aria-hidden="true" />
          <h1 className="hand">{t.personMissingTitle}</h1>
          <p>{t.personMissingBody}</p>
          <button className="btn" onClick={toTimeline}>
            {t.allMemories}
          </button>
        </section>
      </div>
    )
  }
  const person = state.value
  const day = (moment: Moment) => formatDate(language, moment.at, moment.timezone)
  return (
    <div className="page">
      {back}
      <h1 className="mdate hand">{person.name}</h1>
      <dl className="facts slip">
        <i className="tape" aria-hidden="true" />
        {person.first && person.last && (
          <>
            <div>
              <dt>{t.firstMemory}</dt>
              <dd className="hand">{day(person.first)}</dd>
            </div>
            <div>
              <dt>{t.latestMemory}</dt>
              <dd className="hand">{day(person.last)}</dd>
            </div>
          </>
        )}
        <div>
          <dd className="hand">{person.photo_count === 0 ? t.noPhotos : t.photosSent(String(person.photo_count))}</dd>
        </div>
      </dl>
      <Memories onSessionLost={onSessionLost} person={id} listName={person.name} />
    </div>
  )
}
