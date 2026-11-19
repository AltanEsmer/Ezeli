import { type CSSProperties, useCallback, useEffect, useState } from 'react'
import { formatDate, language, t } from './i18n.ts'
import { Memories } from './Memories.tsx'
import { Shot, useLinks } from './MemoryItem.tsx'
import { follow, personPath, toTimeline } from './route.ts'
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

function Failed({ reload }: { reload: () => void }) {
  return (
    <section className="pp-note" role="alert">
      <h2>{t.failedTitle}</h2>
      <p>{t.failedBody}</p>
      <button className="btn" onClick={reload}>
        {t.retry}
      </button>
    </section>
  )
}

// Everyone of the group: the name set large and a strip of the photos they sent, all at one height.
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

  if (state.status === 'loading') return <div aria-busy="true" aria-label={t.loading} />
  return (
    <div className="pp">
      <h1>{t.people}</h1>
      {state.status === 'failed' && <Failed reload={reload} />}
      {state.status === 'ready' && people.length === 0 && (
        <section className="pp-note">
          <h2>{t.noPeople}</h2>
          <p>{t.emptyBody}</p>
        </section>
      )}
      {state.status === 'ready' && people.length > 0 && (
        <ul aria-label={t.people}>
          {people.map((person) => (
            <li key={person.id}>
              <a lang="tr" aria-label={person.name} href={personPath(person.id)} onClick={follow(personPath(person.id))}>
                <h2>{person.name}</h2>
                {person.photos.length === 0 ? (
                  <p lang={language}>{t.noPhotos}</p>
                ) : (
                  <div className="pp-strip">
                    {person.photos.map((photo) => {
                      const ratio = Math.min(1.5, Math.max(0.8, photo.width / photo.height))
                      return (
                        <div key={photo.thumb} style={{ '--ratio': ratio } as CSSProperties}>
                          <Shot url={link.get(photo.thumb)} />
                        </div>
                      )
                    })}
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

  if (state.status === 'loading') return <div aria-busy="true" aria-label={t.loading} />
  if (state.status === 'failed') return <div className="pp"><Failed reload={reload} /></div>
  if (state.status === 'missing') {
    return (
      <div className="notice">
        <p className="brand">Ezeli</p>
        <h1>{t.personMissingTitle}</h1>
        <p>{t.personMissingBody}</p>
        <button className="btn" onClick={toTimeline}>
          {t.allMemories}
        </button>
      </div>
    )
  }
  const person = state.value
  const day = (moment: Moment) => formatDate(language, moment.at, moment.timezone)
  return (
    <>
      <header className="pp pp-head">
        <h1 lang="tr">{person.name}</h1>
        <dl>
          {person.first && person.last && (
            <>
              <div>
                <dt>{t.firstMemory}</dt>
                <dd>{day(person.first)}</dd>
              </div>
              <div>
                <dt>{t.latestMemory}</dt>
                <dd>{day(person.last)}</dd>
              </div>
            </>
          )}
          <div>
            <dd>{person.photo_count === 0 ? t.noPhotos : t.photosSent(String(person.photo_count))}</dd>
          </div>
        </dl>
      </header>
      <Memories onSessionLost={onSessionLost} person={id} listName={person.name} />
    </>
  )
}
