import { useEffect, useState } from 'react'
import { formatDateTime, language, t } from './i18n.ts'
import { type SearchJump, marked, matchRanges, useJumpTarget } from './searchMatch.tsx'
import type { Person } from './session.ts'
import { supabase } from './supabase.ts'

// The comments under a memory's conversation: tinted blocks with an accent line, under their own
// heading, and a plain field to write a new one. A comment is plain text, shown exactly as written.
// Nobody edits.
type Comment = { id: string; body: string; created_at: string; person_id: string; people: { display_name: string } | null }

const FIELDS = 'id, body, created_at, person_id, people(display_name)'
const MAX = 2000

// True when the database no longer knows this session (signed out, or the link was replaced).
async function sessionGone(): Promise<boolean> {
  const who = await supabase.rpc('current_person')
  return !who.error && !who.data[0]
}

export function Comments({ memoryKey, person, onSessionLost, jump }: { jump?: SearchJump; memoryKey: string; person: Person; onSessionLost: () => void }) {
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
    <section className="cm" aria-label={t.comments}>
      <h2>{t.comments}</h2>
      <p className="cm-apart">{t.commentsApart}</p>
      {failed && (
        <div className="cm-failed">
          <p>{t.failedBody}</p>
          <button className="btn" onClick={load}>
            {t.retry}
          </button>
        </div>
      )}
      {list?.map((comment) => (
        <Note query={jump?.id === comment.id ? jump.query : undefined} key={comment.id} comment={comment} person={person} onSessionLost={onSessionLost} onGone={() => setList((now) => now && now.filter((c) => c.id !== comment.id))} />
      ))}
      {memory && <Write memory={memory} onSessionLost={onSessionLost} onAdded={(comment) => setList((now) => [...(now ?? []), comment])} />}
    </section>
  )
}

function Note({ comment, person, onSessionLost, onGone, query }: { query?: string; comment: Comment; person: Person; onSessionLost: () => void; onGone: () => void }) {
  const [asking, setAsking] = useState(false)
  const [failed, setFailed] = useState(false)
  const target = useJumpTarget(Boolean(query))
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
    <article className="cm-note" ref={query ? target : undefined} tabIndex={query ? -1 : undefined}>
      <div className="cm-head">
        <span lang="tr">{comment.people?.display_name}</span>
        <time dateTime={comment.created_at}>{formatDateTime(language, comment.created_at)}</time>
      </div>
      <p lang="tr" dir="auto">
        {query ? marked(comment.body, matchRanges(comment.body, query)) : comment.body}
      </p>
      {(mine || person.is_owner) &&
        (asking ? (
          <div className="cm-ask" role="group" aria-label={t.deleteAsk}>
            <span>{t.deleteAsk}</span>
            <button className="btn" onClick={() => void remove()}>
              {t.deleteYes}
            </button>
            <button className="cm-text" onClick={() => setAsking(false)}>
              {t.deleteNo}
            </button>
          </div>
        ) : (
          <button className="cm-text" onClick={() => setAsking(true)}>
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
    <form className="cm-write" onSubmit={(event) => void send(event)}>
      <label htmlFor="new-comment">
        {t.writeComment}
      </label>
      <textarea id="new-comment" lang="tr" dir="auto" rows={3} maxLength={MAX} value={text} onChange={(event) => setText(event.target.value)} />
      <button className="btn" disabled={!body || busy}>
        {t.addComment}
      </button>
      {failed && <p role="alert">{t.saveFailed}</p>}
    </form>
  )
}
