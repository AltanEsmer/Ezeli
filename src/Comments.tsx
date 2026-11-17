import { type CSSProperties, useEffect, useState } from 'react'
import { formatDateTime, language, t } from './i18n.ts'
import type { Person } from './session.ts'
import { supabase } from './supabase.ts'

// The comments under a memory's conversation: sticky notes, yellow and pink, with a note of the
// same kind to write a new one. A comment is plain text, shown exactly as written. Nobody edits.
type Comment = { id: string; body: string; created_at: string; person_id: string; people: { display_name: string } | null }

const FIELDS = 'id, body, created_at, person_id, people(display_name)'
const MAX = 2000
const tilts = [-1.4, 1.1, -0.7, 1.6]

// True when the database no longer knows this session (signed out, or the link was replaced).
async function sessionGone(): Promise<boolean> {
  const who = await supabase.rpc('current_person')
  return !who.error && !who.data[0]
}

export function Comments({ memoryKey, person, onSessionLost }: { memoryKey: string; person: Person; onSessionLost: () => void }) {
  const [memory, setMemory] = useState<string | null>(null)
  const [list, setList] = useState<Comment[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = () => {
    setFailed(false)
    void (async () => {
      const found = await supabase.from('memories').select('id').eq('key', memoryKey).maybeSingle()
      if (found.error || !found.data) return setFailed(true)
      const comments = await supabase.from('comments').select(FIELDS).eq('memory_id', found.data.id).order('created_at').order('id')
      if (comments.error) return setFailed(true)
      setMemory(found.data.id)
      setList(comments.data as unknown as Comment[])
    })()
  }
  useEffect(load, [memoryKey])

  return (
    <section className="notes" aria-label={t.comments}>
      <p className="apart">{t.commentsApart}</p>
      {failed && (
        <div className="note yellow">
          <p>{t.failedBody}</p>
          <button className="btn" onClick={load}>
            {t.retry}
          </button>
        </div>
      )}
      {list?.map((comment, index) => (
        <Note key={comment.id} comment={comment} index={index} person={person} onSessionLost={onSessionLost} onGone={() => setList((now) => now && now.filter((c) => c.id !== comment.id))} />
      ))}
      {memory && <Write memory={memory} onSessionLost={onSessionLost} onAdded={(comment) => setList((now) => [...(now ?? []), comment])} />}
    </section>
  )
}

function Note({ comment, index, person, onSessionLost, onGone }: { comment: Comment; index: number; person: Person; onSessionLost: () => void; onGone: () => void }) {
  const [asking, setAsking] = useState(false)
  const [failed, setFailed] = useState(false)
  const mine = comment.person_id === person.id

  const remove = async () => {
    const removed = await supabase.from('comments').delete().eq('id', comment.id).select('id')
    // A delete the rules refuse is not an error: the database answers with no rows. Only a row
    // that was really deleted takes the note off the screen.
    if (!removed.error && removed.data.length > 0) return onGone()
    if (await sessionGone()) return onSessionLost()
    setAsking(false)
    setFailed(true)
  }

  return (
    <article className={`note ${index % 2 ? 'pink' : 'yellow'}`} style={{ '--tilt': `${tilts[index % tilts.length]}deg` } as CSSProperties}>
      <p className="text hand" dir="auto">
        {comment.body}
      </p>
      <footer>
        <span className="by hand">{comment.people?.display_name}</span>
        <time dateTime={comment.created_at}>{formatDateTime(language, comment.created_at)}</time>
      </footer>
      {(mine || person.is_owner) &&
        (asking ? (
          <div className="ask" role="group" aria-label={t.deleteAsk}>
            <span>{t.deleteAsk}</span>
            <button className="btn danger" onClick={() => void remove()}>
              {t.deleteYes}
            </button>
            <button className="btn quiet" onClick={() => setAsking(false)}>
              {t.deleteNo}
            </button>
          </div>
        ) : (
          <button className="del" onClick={() => setAsking(true)}>
            {t.deleteComment}
          </button>
        ))}
      {failed && <p role="alert">{t.deleteFailed}</p>}
    </article>
  )
}

function Write({ memory, onSessionLost, onAdded }: { memory: string; onSessionLost: () => void; onAdded: (comment: Comment) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const body = text.trim()

  const send = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!body || busy) return
    setBusy(true)
    setFailed(false)
    const added = await supabase.from('comments').insert({ memory_id: memory, body }).select(FIELDS).single()
    setBusy(false)
    if (added.error) return (await sessionGone()) ? onSessionLost() : setFailed(true)
    setText('')
    onAdded(added.data as unknown as Comment)
  }

  return (
    <form className="note write yellow" onSubmit={(event) => void send(event)} style={{ '--tilt': '0.8deg' } as CSSProperties}>
      <label className="hand" htmlFor="new-comment">
        {t.writeComment}
      </label>
      <textarea id="new-comment" className="hand" dir="auto" rows={3} maxLength={MAX} value={text} onChange={(event) => setText(event.target.value)} />
      <button className="btn" disabled={!body || busy}>
        {t.addComment}
      </button>
      {failed && <p role="alert">{t.saveFailed}</p>}
    </form>
  )
}
