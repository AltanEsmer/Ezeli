import { type CSSProperties, useEffect, useState } from 'react'
import { t } from './i18n.ts'
import type { Person } from './session.ts'
import { supabase } from './supabase.ts'

// The comments under a memory's conversation: sticky notes, yellow and pink, with a note of the
// same kind to write a new one. A comment is plain text, shown exactly as written. Nobody edits.
type Comment = { id: string; body: string; created_at: string; person_id: string; people: { display_name: string } | null }

const FIELDS = 'id, body, created_at, person_id, people(display_name)'
const MAX = 2000
const tilts = [-1.4, 1.1, -0.7, 1.6]

// Date and time as the reader's own clock says.
const when = (moment: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(moment))

export function Comments({ memoryKey, person }: { memoryKey: string; person: Person }) {
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
        <Note key={comment.id} comment={comment} index={index} person={person} onGone={() => setList((now) => now && now.filter((c) => c.id !== comment.id))} />
      ))}
      {memory && <Write memory={memory} onAdded={(comment) => setList((now) => [...(now ?? []), comment])} />}
    </section>
  )
}

function Note({ comment, index, person, onGone }: { comment: Comment; index: number; person: Person; onGone: () => void }) {
  const [asking, setAsking] = useState(false)
  const [failed, setFailed] = useState(false)
  const mine = comment.person_id === person.id

  const remove = async () => {
    const removed = await supabase.from('comments').delete().eq('id', comment.id).select('id')
    if (removed.error) return setFailed(true)
    onGone()
  }

  return (
    <article className={`note ${index % 2 ? 'pink' : 'yellow'}`} style={{ '--tilt': `${tilts[index % tilts.length]}deg` } as CSSProperties}>
      <p className="text hand" dir="auto">
        {comment.body}
      </p>
      <footer>
        <span className="by hand">{comment.people?.display_name}</span>
        <time dateTime={comment.created_at}>{when(comment.created_at)}</time>
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
      {failed && <p role="alert">{t.saveFailed}</p>}
    </article>
  )
}

function Write({ memory, onAdded }: { memory: string; onAdded: (comment: Comment) => void }) {
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
    if (added.error) return setFailed(true)
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
