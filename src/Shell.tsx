import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { type Language, getLanguage, setLanguage, subscribeLanguage, t } from './i18n.ts'
import { follow } from './route.ts'
import type { Person } from './session.ts'
import { supabase } from './supabase.ts'

type Place = 'timeline' | 'people' | 'search'

// The shell of a signed-in person: the bar (left on a PC, top on a phone), the menu and the page it
// frames. `bare` is a memory on a phone: only its own back link, so the photo gets the room.
export function Shell(props: { person: Person; onSignOut: () => void; place: Place; screen: string; bare: boolean; children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const { person } = props
  const link = (place: Place, path: string, label: string, className?: string) => (
    <a href={path} className={className} aria-current={props.place === place ? 'page' : undefined} onClick={follow(path)}>
      {label}
    </a>
  )
  return (
    <div className={`shell${props.bare ? ' bare' : ''}`}>
      <nav className="bar" aria-label={t.places}>
        <a className="brand" href="/" onClick={follow('/')}>
          Ezeli
        </a>
        {link('timeline', '/', t.memories, 'home')}
        {link('people', '/people', t.people)}
        {link('search', '/search', t.search)}
        <button className="menu" aria-label={`${t.menu}: ${person.display_name}`} aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>
          <span className="word">{t.menu}</span>
          <span className="name" lang="tr">
            {person.display_name}
          </span>
        </button>
      </nav>
      {/* A new screen is a new element: it fades in, and the bar stays. */}
      <main key={props.screen} className="content fade-in">
        {props.children}
      </main>
      {menuOpen && <Menu person={person} onClose={closeMenu} onSignOut={props.onSignOut} />}
    </div>
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
      <div ref={card} className="sheet" role="dialog" aria-modal="true" aria-label={t.menu}>
        <button ref={closeButton} className="x" aria-label={t.close} onClick={onClose}>
          ×
        </button>
        <small>{t.signedInAs}</small>
        <strong className="who" lang="tr">
          {props.person.display_name}
        </strong>
        {props.person.is_owner && <span className="owner">{t.owner}</span>}
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

// The two names are always written in their own language. The chosen one is marked.
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
          <button key={code} lang={code} aria-pressed={code === current} onClick={() => choose(code)}>
            {code === 'tr' ? 'Türkçe' : 'English'}
          </button>
        ))}
      </div>
      {failed && <p role="alert" className="failed">{t.saveFailed}</p>}
    </div>
  )
}
