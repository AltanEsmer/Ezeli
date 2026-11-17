import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { type Language, getLanguage, setLanguage, subscribeLanguage, t } from './i18n.ts'
import { Memories } from './Memories.tsx'
import { type Person, useSession } from './session.ts'
import { supabase } from './supabase.ts'

export function App() {
  const { session, signOut, reload } = useSession()
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
        <Note title={t.privateTitle} body={t.privateBody} />
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
      return <Timeline person={session.person} onSignOut={signOut} />
  }
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

function Timeline({ person, onSignOut }: { person: Person; onSignOut: () => void }) {
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

      <Memories />

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

// The two names are always written in their own language. The chosen one is circled in pen.
function LanguageSwitch() {
  const current = useSyncExternalStore(subscribeLanguage, getLanguage)
  const choose = async (next: Language) => {
    if (next === current) return
    setLanguage(next)
    // Remembered on the person. If it cannot be saved, go back rather than pretend.
    const { error } = await supabase.rpc('set_my_language', { chosen: next })
    if (error) setLanguage(current)
  }
  return (
    <div className="lang" role="group" aria-label={t.language}>
      {(['tr', 'en'] as const).map((code) => (
        <button key={code} lang={code} className={`hand${code === current ? ' on' : ''}`} aria-pressed={code === current} onClick={() => void choose(code)}>
          {code === 'tr' ? 'Türkçe' : 'English'}
        </button>
      ))}
    </div>
  )
}
