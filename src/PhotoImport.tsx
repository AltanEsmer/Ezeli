import { type FormEvent, useEffect, useRef, useState } from 'react'
import { t } from './i18n.ts'
import { follow, memoryPath } from './route.ts'
import type { Person } from './session.ts'
import { supabase } from './supabase.ts'

type Draft = { id: string; file: File }
const bucket = supabase.storage.from('photos')

export function PhotoImport({ person, onSessionLost }: { person: Person; onSessionLost: () => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [saved, setSaved] = useState<{ id: string; name: string }[]>([])

  async function checkSession() {
    const who = await supabase.rpc('current_person')
    if (!who.error && !who.data[0]) onSessionLost()
  }

  return (
    <section className="photo-import">
      <h1>{t.importPhotos}</h1>
      <label className="photo-import-field">
        {t.choosePhotos}
        <input type="file" accept="image/*" multiple onChange={(event) => {
          const selected = Array.from(event.currentTarget.files ?? [], (file) => ({ id: crypto.randomUUID(), file }))
          setDrafts((current) => [...current, ...selected])
          event.currentTarget.value = ''
        }} />
      </label>
      {drafts.map((draft) => (
        <PhotoDraft key={draft.id} draft={draft} personId={person.id} onFailed={() => void checkSession()}
          onRemove={() => setDrafts((current) => current.filter(({ id }) => id !== draft.id))}
          onSaved={() => {
            setDrafts((current) => current.filter(({ id }) => id !== draft.id))
            setSaved((current) => [...current, { id: draft.id, name: draft.file.name }])
          }} />
      ))}
      {saved.length > 0 && (
        <div role="status">
          <p>{t.photoSaved}</p>
          <ul>
            {saved.map(({ id, name }) => {
              const path = memoryPath(`manual:${id}`)
              return <li key={id}><a href={path} onClick={follow(path, { path: '/import', name: t.importPhotos })}>{name}</a></li>
            })}
          </ul>
        </div>
      )}
    </section>
  )
}

function PhotoDraft({ draft, personId, onFailed, onRemove, onSaved }: {
  draft: Draft; personId: string; onFailed: () => void; onRemove: () => void; onSaved: () => void
}) {
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'format' | 'save' | null>(null)
  const saving = useRef(false)
  useEffect(() => {
    const url = URL.createObjectURL(draft.file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [draft.file])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving.current) return
    const fields = new FormData(event.currentTarget)
    const at = new Date(String(fields.get('at')))
    if (!Number.isFinite(at.getTime())) return
    saving.current = true
    setBusy(true)
    setError(null)
    try {
      const sizes = await webPhotos(draft.file).catch(() => null)
      if (!sizes) {
        setError('format')
        return
      }
      const [view, thumb] = sizes
      const prefix = `manual/${personId}/${draft.id}`
      await saveFile(`${prefix}-view.webp`, view.blob)
      await saveFile(`${prefix}-thumb.webp`, thumb.blob)
      const published = await supabase.rpc('import_photo', {
        p_id: draft.id,
        p_at: at.toISOString(),
        p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        p_place: String(fields.get('place')).trim(),
        p_comment: String(fields.get('caption')).trim(),
        p_width: view.width,
        p_height: view.height,
      })
      if (published.error) throw published.error
      onSaved()
    } catch {
      setError('save')
      onFailed()
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return (
    <form className="photo-import-draft" onSubmit={(event) => void save(event)}>
      <figure>
        {preview && <img src={preview} alt="" />}
        <figcaption>{draft.file.name}</figcaption>
      </figure>
      <fieldset disabled={busy} aria-label={draft.file.name}>
        <label className="photo-import-field">{t.takenAt}<input name="at" type="datetime-local" required /></label>
        <label className="photo-import-field">{t.photoPlace}<input name="place" maxLength={160} /></label>
        <label className="photo-import-field">{t.photoCaption}<textarea name="caption" rows={2} maxLength={2000} /></label>
        <div className="photo-import-actions">
          <button className="btn" type="submit">{busy ? t.savingPhoto : t.savePhoto}</button>
          <button type="button" onClick={onRemove}>{t.cancelPhoto}</button>
        </div>
        {error && <p role="alert">{error === 'format' ? t.photoFormat : t.saveFailed}</p>}
      </fieldset>
    </form>
  )
}

async function saveFile(path: string, blob: Blob) {
  const uploaded = await bucket.upload(path, blob, { contentType: 'image/webp' })
  if (!uploaded.error) return
  // A prior attempt can store the file before losing its connection.
  const existing = await bucket.createSignedUrl(path, 60)
  if (existing.error) throw uploaded.error
}

async function webPhotos(file: File) {
  const bitmap = await createImageBitmap(file)
  try {
    const view = await encode(bitmap, 1600)
    const thumb = Math.max(view.width, view.height) <= 720 ? view : await encode(bitmap, 720)
    return [view, thumb] as const
  } finally {
    bitmap.close()
  }
}

async function encode(bitmap: ImageBitmap, longestSide: number) {
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, longestSide / Math.max(bitmap.width, bitmap.height))
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86))
  if (!blob || blob.type !== 'image/webp' || blob.size > 5242880) throw new Error('Could not encode photo')
  return { blob, width: canvas.width, height: canvas.height }
}
