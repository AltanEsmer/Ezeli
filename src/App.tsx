import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { type Language, getLanguage, setLanguage, subscribeLanguage, t } from './i18n.ts'
import { Memories } from './Memories.tsx'
import { MemoryPage } from './MemoryPage.tsx'
import { PeoplePage, PersonPage } from './People.tsx'
import { follow, navigate, useRoute } from './route.ts'
import { type Person, useSession } from './session.ts'
import { supabase } from './supabase.ts'

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
      return <main className="page" aria-busy="true" aria-label={t.loading} />
    case 'private':
      return session.badLink ? (
        <Note tone="red" title={t.badLinkTitle} body={t.badLinkBody} />
      ) : (
        // A memory's address says what to do first; the rest of the app does not know the person yet.
        <Note title={t.privateTitle} body={route.name === 'memory' ? t.privateMemoryBody : t.privateBody} />
      )
    case 'failed':
      return (
        <Note tone="red" title={t.failedTitle} body={t.failedBody}>
          <button className="btn" onClick={() => void reload()}>
            {t.retry}
          </button>
        </Note>
      )
    case 'in':
      return <Signed person={session.person} onSignOut={signOut} onSessionLost={() => void reload()} />
  }
}

// The screens of a signed-in person, by address.
function Signed(props: { person: Person; onSignOut: () => void; onSessionLost: () => void }) {
  const route = useRoute()
  // A path the app does not know is the timeline, and says so in the address bar.
  const unknown = route.name === 'timeline' && location.pathname !== '/'
  useEffect(() => {
    if (unknown) navigate('/', { replace: true })
  }, [unknown])
  if (route.name === 'memory') return <MemoryPage key={route.key} memoryKey={route.key} person={props.person} onSessionLost={props.onSessionLost} />
  if (route.name === 'people') return <PeoplePage onSessionLost={props.onSessionLost} />
  if (route.name === 'person') return <PersonPage key={route.id} id={route.id} onSessionLost={props.onSessionLost} />
  return <Timeline person={props.person} onSignOut={props.onSignOut} onSessionLost={props.onSessionLost} />
}

// One taped slip of paper in the middle of the page: the private page and its variants.
function Note(props: { title: string; body: string; tone?: 'red'; children?: React.ReactNode }) {
  return (
    <main className="page centered">
      <section className={`slip${props.tone === 'red' ? ' red' : ''}`}>
        <i className="tape" aria-hidden="true" />
        <h1 className="hand">{props.title}</h1>
        <p>{props.body}</p>
        {props.children}
      </section>
    </main>
  )
}

function Timeline({ person, onSignOut, onSessionLost }: { person: Person; onSignOut: () => void; onSessionLost: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  return (
    <main className="page">
      <header className="top">
        <span className="logo hand">Ezeli</span>
        <button
          className="me hand"
          aria-label={`${t.menu}: ${person.display_name}`}
          aria-haspopup="dialog"
          onClick={() => setMenuOpen(true)}
        >
          <span className="name">{person.display_name}</span>
          <span aria-hidden="true">▾</span>
        </button>
      </header>

      {/* Where else to go, as a plain list of handwritten links (the search screen adds its own). */}
      <ul className="links">
        <li>
          <a className="hand" href="/people" onClick={follow('/people')}>
            {t.people}
          </a>
        </li>
      </ul>

      <Memories onSessionLost={onSessionLost} />

      {menuOpen && <Menu person={person} onClose={closeMenu} onSignOut={onSignOut} />}
    </main>
  )
}

function Menu(props: { person: Person; onClose: () => void; onSignOut: () => void }) {
  const card = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const { onClose } = props

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    closeButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return onClose()
      if (event.key !== 'Tab' || !card.current) return
      // Keep Tab inside the card while it is open.
      const inside = [...card.current.querySelectorAll<HTMLElement>('button')]
      const first = inside[0]!
      const last = inside[inside.length - 1]!
      if (!card.current.contains(document.activeElement)) {
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
    return () => {
      window.removeEventListener('keydown', onKey)
      opener?.focus()
    }
  }, [onClose])

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={card} className="card" role="dialog" aria-modal="true" aria-label={t.menu}>
        <i className="tape" aria-hidden="true" />
        <button ref={closeButton} className="x" aria-label={t.close} onClick={onClose}>
          ×
        </button>
        <small>{t.signedInAs}</small>
        <strong className="hand who">{props.person.display_name}</strong>
        {props.person.is_owner && <span className="stamp">{t.owner}</span>}
        <LanguageSwitch />
        <button className="btn" onClick={props.onSignOut}>
          {t.signOut}
        </button>
      </div>
    </>
  )
}

// Saves go one after another, so the last tap is what ends up stored. While one is on its way a
// new tap only changes what is wanted; the loop then sends it. If a save fails the screen goes back
// to the last language that was stored, and the caller is told.
let saving: { stored: Language; wanted: Language } | null = null
async function chooseLanguage(next: Language, failed: () => void) {
  const before = getLanguage()
  setLanguage(next)
  if (saving) {
    saving.wanted = next
    return
  }
  const state = (saving = { stored: before, wanted: next })
  while (state.stored !== state.wanted) {
    const sending = state.wanted
    const { error } = await supabase.rpc('set_my_language', { chosen: sending })
    if (error) {
      setLanguage(state.stored)
      saving = null
      return failed()
    }
    state.stored = sending
  }
  saving = null
}

// The two names are always written in their own language. The chosen one is circled in pen.
function LanguageSwitch() {
  const current = useSyncExternalStore(subscribeLanguage, getLanguage)
  const [failed, setFailed] = useState(false)
  const choose = (next: Language) => {
    if (next === current) return
    setFailed(false)
    void chooseLanguage(next, () => setFailed(true))
  }
  return (
    <div className="lang" role="group" aria-labelledby="lang-title">
      <small id="lang-title">{t.language}</small>
      <div>
        {(['tr', 'en'] as const).map((code) => (
          <button key={code} lang={code} className={`hand${code === current ? ' on' : ''}`} aria-pressed={code === current} onClick={() => choose(code)}>
            {code === 'tr' ? 'Türkçe' : 'English'}
          </button>
        ))}
      </div>
      {failed && <p role="alert" className="failed">{t.saveFailed}</p>}
    </div>
  )
}
