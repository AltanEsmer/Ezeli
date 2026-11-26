import { useLayoutEffect, useRef } from 'react'

export type SearchMatch = { id: string; kind: 'message' | 'comment'; quote: string }
export type SearchJump = Omit<SearchMatch, 'quote'> & { query: string }

export function useJumpTarget(active: boolean) {
  const target = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!active) return
    target.current?.focus({ preventScroll: true })
    target.current?.scrollIntoView({ block: 'center' })
  }, [active])
  return target
}

// Mirror the database's Turkish folding and retain the original character offsets.
const letters = 'İIıŞşĞğÜüÖöÇçÂâÎîÛû'
const folded = 'iiissgguuooccaaiiuu'
const fold = (value: string) => value.normalize('NFC')
  .replace(/[İIıŞşĞğÜüÖöÇçÂâÎîÛû]/g, (letter) => folded[letters.indexOf(letter)]!)
  .replace(/[\u0307\u0306\u0308\u0327\u0302\u0301]/g, '').toLowerCase()

export function matchRanges(text: string, query: string): [number, number][] {
  const offsets: { start: number; end: number }[] = []
  let comparable = ''
  for (const { segment, index } of new Intl.Segmenter().segment(text)) {
    const piece = fold(segment)
    comparable += piece
    for (let i = 0; i < piece.length; i++) offsets.push({ start: index, end: index + segment.length })
  }
  const words = fold(query).split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)
  if (!words.length) return []
  const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return [...comparable.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})`, 'gu'))]
    .map((hit) => [offsets[hit.index]!.start, offsets[hit.index + hit[0].length - 1]!.end])
}

export function searchQuote(text: string, query: string) {
  const compact = text.trim().replace(/\s+/g, ' ')
  const hits = matchRanges(compact, query)
  if (compact.length <= 140 || !hits.length) return compact.slice(0, 140) + (compact.length > 140 ? '…' : '')
  const start = Math.max(0, hits[0]![0] - 18)
  const end = Math.min(compact.length, start + 140)
  return (start > 0 ? '…' : '') + compact.slice(start, end) + (end < compact.length ? '…' : '')
}

export function marked(text: string, ranges: [number, number][], offset = 0) {
  const parts = []
  let cursor = 0
  for (const [start, end] of ranges) {
    const from = Math.max(cursor, start - offset)
    const to = Math.min(text.length, end - offset)
    if (from >= to) continue
    parts.push(text.slice(cursor, from), <mark key={start}>{text.slice(from, to)}</mark>)
    cursor = to
  }
  return [...parts, text.slice(cursor)]
}
