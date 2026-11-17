import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.ts'

// One row of the `timeline` view: a memory with its main photos, in one request.
export type MemoryCard = {
  id: string
  // The memory's lasting key: its address is built from it.
  key: string
  at: string
  timezone: string
  photo_count: number
  photos: { thumb: string; width: number; height: number; by: string }[]
  senders: string[]
}

export type Timeline =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; memories: MemoryCard[]; links: Map<string, string> }

// How many memories the timeline fetches. Loading more as the reader scrolls is issue 15.
const FIRST_MEMORIES = 100
// Photos reach the app through links that stop working after this many seconds.
const LINK_SECONDS = 3600

export function useTimeline(): { timeline: Timeline; reload: () => void } {
  const [timeline, setTimeline] = useState<Timeline>({ status: 'loading' })

  const reload = useCallback(() => {
    setTimeline({ status: 'loading' })
    void (async () => {
      const found = await supabase.from('timeline').select('*').order('at', { ascending: false }).limit(FIRST_MEMORIES)
      if (found.error) return setTimeline({ status: 'failed' })
      const memories = found.data as MemoryCard[]

      const paths = [...new Set(memories.flatMap((memory) => memory.photos.map((photo) => photo.thumb)))]
      const links = new Map<string, string>()
      if (paths.length > 0) {
        const signed = await supabase.storage.from('photos').createSignedUrls(paths, LINK_SECONDS)
        if (signed.error) return setTimeline({ status: 'failed' })
        for (const item of signed.data) if (item.path && item.signedUrl) links.set(item.path, item.signedUrl)
      }
      setTimeline({ status: 'ready', memories, links })
    })()
  }, [])

  useEffect(reload, [reload])
  return { timeline, reload }
}
