// Photos: read them, and make the two sizes that are stored. Originals are never uploaded.
import { readFileSync } from 'node:fs'
import decodeHeic from 'heic-decode'
import sharp, { type Sharp } from 'sharp'

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

// The photo as an image to work on. sharp's own build cannot read iPhone HEIC photos (HEVC is
// patented and left out), so those are decoded first, in JavaScript, whatever the install.
async function open(file: string): Promise<Sharp> {
  if (!/\.(heic|heif)$/i.test(file)) return sharp(file)
  const { width, height, data } = await decodeHeic({ buffer: readFileSync(file) })
  return sharp(Buffer.from(data.buffer), { raw: { width, height, channels: 4 } })
}

// Why a photo cannot be read, or undefined when it can. Decodes a tiny version, which is cheap
// for JPEG and fails for a file that is not a picture.
export async function whyUnreadable(file: string): Promise<string | undefined> {
  try {
    await (await open(file)).resize(16, 16, { fit: 'inside' }).toBuffer()
    return undefined
  } catch (error) {
    return (error as Error).message.replace(/\s+/g, ' ')
  }
}

export async function makeSizes(file: string): Promise<StoredPhoto> {
  const photo = await open(file)
  const make = (size: { longEdge: number; quality: number }) =>
    photo
      .clone()
      .rotate()
      .resize({ width: size.longEdge, height: size.longEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: size.quality })
      .toBuffer({ resolveWithObject: true })
  const [view, thumb] = await Promise.all([make(sizes.view), make(sizes.thumb)])
  return { view: view.data, thumb: thumb.data, width: view.info.width, height: view.info.height }
}
