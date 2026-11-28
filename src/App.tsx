import { lazy, Suspense, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { GlobeView } from './globeCamera.ts'
import { GlobeBoundary } from './GlobeUnavailable.tsx'
import { getLanguage, subscribeLanguage, t } from './i18n.ts'
import { Memories } from './Memories.tsx'
import { MemoryPage } from './MemoryPage.tsx'
import { PhotoImport } from './PhotoImport.tsx'
import { Search } from './Search.tsx'
import { PeoplePage, PersonPage } from './People.tsx'
import { navigate, useGlobeEntry, useRoute } from './route.ts'
import { type Person, useSession } from './session.ts'
import { Shell } from './Shell.tsx'

const Globe = lazy(() => import('./Globe.tsx'))

export function App() {
  const { session, signOut, reload } = useSession()
  const route = useRoute()
  // Re-renders everything below when the language changes; `t` is read fresh on each render.
  const language = useSyncExternalStore(subscribeLanguage, getLanguage)
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  switch (session.status) {
    case 'loading':
      // Nothing but the page background.
      return <main aria-busy="true" aria-label={t.loading} />
    case 'private':
      return session.badLink ? (
        <Notice title={t.badLinkTitle} body={t.badLinkBody} />
      ) : (
        // A memory's address says what to do first; the rest of the app does not know the person yet.
        <Notice title={t.privateTitle} body={route.name === 'memory' ? t.privateMemoryBody : t.privateBody} />
      )
    case 'failed':
      return (
        <Notice title={t.failedTitle} body={t.failedBody}>
          <button className="btn" onClick={() => void reload()}>
            {t.retry}
          </button>
        </Notice>
      )
    case 'in':
      return <Signed person={session.person} onSignOut={signOut} onSessionLost={reload} />
  }
}

// The screens of a signed-in person, by address, inside the shell.
function Signed({ person, onSignOut, onSessionLost }: { person: Person; onSignOut: () => void; onSessionLost: () => void }) {
  const route = useRoute()
  const entry = useGlobeEntry()
  const globeViews = useMemo(() => new Map<string, GlobeView>(), [person.id])
  // A path the app does not know is the timeline, and says so in the address bar.
  const unknown = route.name === 'timeline' && location.pathname !== '/'
  useEffect(() => {
    if (unknown) navigate('/', { replace: true })
  }, [unknown])
  const place = route.name === 'photo-import' || route.name === 'search' || route.name === 'globe' ? route.name : route.name === 'people' || route.name === 'person' ? 'people' : 'timeline'
  const screen = route.name === 'memory' ? `m/${route.key}` : route.name === 'person' ? `p/${route.id}` : route.name
  return (
    <Shell
      person={person} onSignOut={onSignOut} place={place} screen={screen} bare={route.name === 'memory'}
      photoImport={<PhotoImport key={person.id} person={person} onSessionLost={onSessionLost} />}
    >
      {route.name === 'memory' ? (
        <MemoryPage memoryKey={route.key} person={person} onSessionLost={onSessionLost} />
      ) : route.name === 'photo-import' ? (
        null
      ) : route.name === 'globe' ? (
        <GlobeBoundary key={`${person.id}:${entry}`}>
          <Suspense fallback={<div aria-busy="true" aria-label={t.loading} />}>
            <Globe onSessionLost={onSessionLost} entry={entry} views={globeViews} />
          </Suspense>
        </GlobeBoundary>
      ) : route.name === 'search' ? (
        <Search onSessionLost={onSessionLost} />
      ) : route.name === 'people' ? (
        <PeoplePage onSessionLost={onSessionLost} />
      ) : route.name === 'person' ? (
        <PersonPage id={route.id} onSessionLost={onSessionLost} />
      ) : (
        <Memories onSessionLost={onSessionLost} />
      )}
    </Shell>
  )
}

// The private page, the bad-link page and the failed page: the name, a heading, one short paragraph,
// and a button where there is something to do.
function Notice(props: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <main className="notice">
      <p className="brand">Ezeli</p>
      <h1>{props.title}</h1>
      <p>{props.body}</p>
      {props.children}
    </main>
  )
}
