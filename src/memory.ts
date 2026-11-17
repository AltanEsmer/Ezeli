import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.ts'

// What `memory_detail` returns, in one request: the memory, its photos and all its messages.
export type MemoryDetail = {
  at: string
  chat_name: string
  timezone: string
  photos: { message: string; view: string; thumb: string; width: number; height: number; by: string }[]
  messages: { id: string; by: string; at: string; text: string; kind: 'photo' | 'video' | 'gif' | 'voice' | 'document' | null }[]
  // The keys of the memory before and after this one in time.
  before: string | null
  after: string | null
}

export type MemoryState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'missing' }
  | { status: 'ready'; memory: MemoryDetail; links: Map<string, string> }

const LINK_SECONDS = 3600

export function useMemory(key: string): { state: MemoryState; reload: () => void } {
  const [state, setState] = useState<MemoryState>({ status: 'loading' })

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    void (async () => {
      const found = await supabase.rpc('memory_detail', { p_key: key })
      if (found.error) return setState({ status: 'failed' })
      // A memory that is not there and one the reader may not see both come back as null.
      const memory = found.data as MemoryDetail | null
      if (!memory) return setState({ status: 'missing' })

      const paths = [...new Set(memory.photos.flatMap((photo) => [photo.view, photo.thumb]))]
      const links = new Map<string, string>()
      const signed = await supabase.storage.from('photos').createSignedUrls(paths, LINK_SECONDS)
      if (signed.error) return setState({ status: 'failed' })
      for (const item of signed.data) if (item.path && item.signedUrl) links.set(item.path, item.signedUrl)
      setState({ status: 'ready', memory, links })
    })()
  }, [key])

  useEffect(reload, [reload])
  return { state, reload }
}
