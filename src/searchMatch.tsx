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

const escapePattern = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wordStart = '(?<![\\p{L}\\p{N}])'

export function matchRanges(text: string, query: string, preferPhrase = false): [number, number][] {
  const offsets: { start: number; end: number }[] = []
  let comparable = ''
  for (const { segment, index } of new Intl.Segmenter().segment(text)) {
    const piece = fold(segment)
    comparable += piece
    for (let i = 0; i < piece.length; i++) offsets.push({ start: index, end: index + segment.length })
  }
  const words = fold(Array.from(query).slice(0, 1000).join('')).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const pattern = [...new Set(words)].slice(0, 8).sort((a, b) => b.length - a.length).map(escapePattern).join('|')
  const phrase = preferPhrase
    ? new RegExp(`${wordStart}${escapePattern(words.join(' '))}(?![\\p{L}\\p{N}])`, 'u').exec(comparable)
    : null
  const hits = phrase ? [phrase] : comparable.matchAll(new RegExp(`${wordStart}(?:${pattern})`, 'gu'))
  return Array.from(hits, (hit) => [offsets[hit.index]!.start, offsets[hit.index + hit[0].length - 1]!.end])
}

export function searchQuote(text: string, query: string) {
  const compact = text.trim().replace(/\s+/g, ' ')
  if (compact.length <= 140) return compact
  const hit = matchRanges(compact, query, true)[0]
  const start = hit ? Math.max(0, Math.min(hit[0], Math.max(hit[0] - 18, hit[1] - 140))) : 0
  const end = Math.min(compact.length, Math.max(start + 140, hit?.[1] ?? 0))
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
