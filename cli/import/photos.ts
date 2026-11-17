// Photos: read them, and make the two sizes that are stored. Originals are never uploaded.
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync as removeFolder } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import decodeHeic from 'heic-decode'
import sharp from 'sharp'

// One for viewing, one small for the timeline. Both WebP, turned upright by the photo's own
// rotation mark, with the rest of the photo's metadata (such as where it was taken) dropped.
const sizes = {
  view: { longEdge: 1600, quality: 80 },
  thumb: { longEdge: 720, quality: 75 },
}

export type StoredPhoto = {
  view: Buffer
  thumb: Buffer
  width: number // of the viewing size
  height: number
}

// iPhone HEIC photos are converted during the import. sharp's own build cannot read them (HEVC is
// patented and left out), so they are decoded here with heic-decode (libheif as WebAssembly, a
// dev dependency used by this command only) and kept as a JPEG in a temporary folder until the run
// ends. A file is HEIC by what is in it, not by its name. It is decoded once.
const heicBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'])
let converted: string | undefined

function isHeic(file: string): boolean {
  const head = readFileSync(file).subarray(0, 12)
  return head.subarray(4, 8).toString('latin1') === 'ftyp' && heicBrands.has(head.subarray(8, 12).toString('latin1'))
}

// The file to read the photo from (a JPEG made from a HEIC, or the file itself), or why it
// cannot be read. Decodes a tiny version of an ordinary photo, which is cheap for JPEG and fails
// for a file that is not a picture.
export async function readablePhoto(file: string): Promise<{ file: string } | { reason: string }> {
  try {
    if (!isHeic(file)) {
      await sharp(file).resize(16, 16, { fit: 'inside' }).toBuffer()
      return { file }
    }
    const { width, height, data } = await decodeHeic({ buffer: readFileSync(file) })
    converted ??= mkdtempSync(join(tmpdir(), 'ezeli-heic-'))
    const out = join(converted, `${randomUUID()}.jpg`)
    // The decoder has already turned the photo upright and carries no metadata.
    await sharp(Buffer.from(data.buffer), { raw: { width, height, channels: 4 } }).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toFile(out)
    return { file: out }
  } catch (error) {
    return { reason: (error as Error).message.replace(/\s+/g, ' ') }
  }
}

// Called when the run ends: the converted photos are only needed until then.
export function removeConvertedPhotos(): void {
  if (converted) removeFolder(converted, { recursive: true, force: true })
  converted = undefined
}

export async function makeSizes(file: string): Promise<StoredPhoto> {
  const make = (size: { longEdge: number; quality: number }) =>
    sharp(file)
      .rotate()
      .resize({ width: size.longEdge, height: size.longEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: size.quality })
      .toBuffer({ resolveWithObject: true })
  const [view, thumb] = await Promise.all([make(sizes.view), make(sizes.thumb)])
  return { view: view.data, thumb: thumb.data, width: view.info.width, height: view.info.height }
}
