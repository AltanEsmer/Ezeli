import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.ts'

export type MemoryDetail = {
  at: string
  chat_name: string
  place?: string | null
  timezone: string
  photos: { message: string; by_id: string | null; view: string; thumb: string; width: number; height: number; by: string }[]
  messages: { id: string; by: string; by_id: string | null; at: string; text: string; clip?: string | null; kind: 'photo' | 'video' | 'gif' | 'voice' | 'document' | 'media' | null }[]
  before: string | null
  after: string | null
}

export type MemoryState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'missing' }
  | { status: 'gone' }
  | { status: 'ready'; memory: MemoryDetail; links: Map<string, string> }

const LINK_SECONDS = 3600

async function sign(memory: MemoryDetail): Promise<Map<string, string> | null> {
  const photos = [...new Set(memory.photos.flatMap((photo) => [photo.view, photo.thumb]))]
  const clips = memory.messages.flatMap((message) => message.clip ? [message.clip] : [])
  const [pictures, recordings] = await Promise.all([
    supabase.storage.from('photos').createSignedUrls(photos, LINK_SECONDS),
    clips.length ? supabase.storage.from('clips').createSignedUrls(clips, LINK_SECONDS) : null,
  ])
  if (pictures.error) return null
  const links = new Map<string, string>()
  for (const item of [...pictures.data, ...(recordings?.data ?? [])]) if (item.path && item.signedUrl) links.set(item.path, item.signedUrl)
  return links
}

export function useMemory(key: string): { state: MemoryState; reload: () => void; relink: () => Promise<boolean> } {
  const [state, setState] = useState<MemoryState>({ status: 'loading' })
  const fresh = useRef<{ memory: MemoryDetail; response: Promise<boolean> } | null>(null)

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    void (async () => {
      const found = await supabase.rpc('memory_detail', { p_key: key })
      if (found.error) return setState({ status: 'failed' })
      // A memory that is not there and one the reader may not see both come back as null.
      const memory = found.data as MemoryDetail | null
      if (!memory) {
        // Null is also what a session that has ended gets, so ask whose session this is.
        const who = await supabase.rpc('current_person')
        return setState({ status: !who.error && !who.data[0] ? 'gone' : 'missing' })
      }

      const links = await sign(memory)
      if (!links) return setState({ status: 'failed' })
      setState({ status: 'ready', memory, links })
    })()
  }, [key])

  // A loaded memory shares one refresh across media that fail while its links are being replaced.
  const relink = useCallback(() => {
    if (state.status !== 'ready') return Promise.resolve(false)
    const memory = state.memory
    if (fresh.current?.memory !== memory) {
      const response = sign(memory).then((links) => {
        if (links) setState((current) => current.status === 'ready' && current.memory === memory
          ? { ...current, links } : current)
        return links !== null
      })
      fresh.current = { memory, response }
    }
    return fresh.current.response
  }, [state])

  useEffect(reload, [reload])
  return { state, reload, relink }
}
