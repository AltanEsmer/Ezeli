import { useEffect, useRef, useState } from 'react'
import { t } from './i18n.ts'
import { type Person, useSession } from './session.ts'

export function App() {
  const { session, signOut, reload } = useSession()

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

      {menuOpen && <Menu person={person} onClose={() => setMenuOpen(false)} onSignOut={onSignOut} />}
    </main>
  )
}

function Menu(props: { person: Person; onClose: () => void; onSignOut: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const { onClose } = props

  useEffect(() => {
    closeButton.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="card" role="dialog" aria-modal="true" aria-label={t.menu}>
        <i className="tape" aria-hidden="true" />
        <button ref={closeButton} className="x" aria-label={t.close} onClick={onClose}>
          ×
        </button>
        <small>{t.signedInAs}</small>
        <strong className="hand who">{props.person.display_name}</strong>
        {props.person.is_owner && <span className="stamp">{t.owner}</span>}
        <button className="btn" onClick={props.onSignOut}>
          {t.signOut}
        </button>
      </div>
    </>
  )
}
