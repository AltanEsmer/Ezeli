import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Media } from './chat.ts'
import { hasPhotoFile, type Memory } from './memories.ts'
import { removePhoneNumbers } from './text.ts'
import { momentText } from './time.ts'

const MAX_BYTES = 25 * 1024 * 1024
const VIDEO_SECONDS = 120
let scratch: string | undefined
let next = 0

export type Clip = { file: string; extension: 'mp4' | 'm4a'; type: 'video/mp4' | 'audio/mp4' }

type SavedClips = {
  exported: ReadonlySet<string>
  photos: ReadonlyMap<string, unknown>
  messages: ReadonlyMap<string, { clip_path: string | null }>
}

export function prepareMemoryClips(memories: Memory[], timezone: string, saved?: SavedClips): string[] {
  const notes: string[] = []
  let playable = 0
  let skipped = 0
  for (const memory of memories) {
    const visible = memory.messages.some((message) => hasPhotoFile(message) || saved?.photos.has(message.key))
    for (const message of memory.messages) {
      if (saved && !saved.exported.has(message.key)) continue
      const media = message.media
      if (!media || !(media.ambiguousAudio || media.kind === 'video' || media.kind === 'voice')) continue
      const where = `${message.person}, ${momentText(message.at, timezone)}`
      const label = media.name ?? media.kind
      if (visible && saved?.messages.get(message.key)?.clip_path) {
        playable++
        notes.push(`Clip already playable (${where}): ${label}`)
        continue
      }
      const outcome = visible ? prepareClip(media) : 'memory has no photo file'
      if (typeof outcome === 'string') {
        skipped++
        notes.push(`Clip skipped (${where}): ${label} — ${outcome}`)
      } else {
        media.clip = outcome
        playable++
        notes.push(`Clip eligible for playback (${where}): ${label}`)
      }
    }
  }
  return notes.length ? [`Clips: ${playable} playable, ${skipped} skipped.`, ...notes.map(removePhoneNumbers)] : []
}

export function removeConvertedClips() {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
  scratch = undefined
}

function run(tool: string, args: string[]) {
  const result = spawnSync(tool, args, { encoding: 'utf8', timeout: 180_000, maxBuffer: 128 * 1024 })
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT' || code === 'EACCES') return undefined
  return result.status === 0 ? result.stdout : null
}

function prepareClip(media: Media): Clip | string {
  if (media.ambiguousAudio) return 'audio has no reliable voice-note marker'
  if (!media.file) return 'file missing from export'
  const video = media.kind === 'video'
  const output = run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries',
    'format=duration:stream=codec_type,duration:stream_disposition=attached_pic', '-of', 'json', '-i', media.file])
  if (output === undefined) return 'ffprobe is unavailable (install FFmpeg on PATH)'
  if (!output) return 'file could not be read'
  const info = JSON.parse(output) as {
    format?: { duration?: string }
    streams?: { codec_type: string; duration?: string; disposition?: { attached_pic?: number } }[]
  }
  const streams = info.streams ?? []
  const track = streams.find((stream) => stream.codec_type === (video ? 'video' : 'audio') && !stream.disposition?.attached_pic)
  if (!track) return video ? 'no video track' : 'no audio track'
  if (video) {
    const durations = [info.format?.duration, ...streams.map((stream) => stream.duration)]
      .map(Number).filter((duration) => Number.isFinite(duration) && duration > 0)
    if (!durations.length) return 'duration unavailable'
    if (Math.max(...durations) > VIDEO_SECONDS) return 'video is over two minutes'
  }

  scratch ??= mkdtempSync(join(tmpdir(), 'ezeli-clips-'))
  const extension = video ? 'mp4' : 'm4a'
  const type = video ? 'video/mp4' : 'audio/mp4'
  const file = join(scratch, `${next++}.${extension}`)
  const converted = run('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', media.file,
    ...(video ? ['-map', '0:V:0', '-map', '0:a:0?', '-vf', "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:v', 'libx264', '-preset', 'fast', '-crf', '25', '-maxrate', '1200k', '-bufsize', '2400k', '-pix_fmt', 'yuv420p'] : ['-map', '0:a:0']),
    '-c:a', 'aac', '-b:a', video ? '96k' : '64k', '-ac', video ? '2' : '1',
    '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', '-fs', String(MAX_BYTES + 1024 * 1024), file])
  if (converted === undefined) return 'ffmpeg is unavailable (install FFmpeg on PATH)'
  if (converted === null) return 'could not prepare a playback copy'
  if (statSync(file).size >= MAX_BYTES) return 'playback copy exceeds 25 MiB'
  return { file, extension, type }
}
