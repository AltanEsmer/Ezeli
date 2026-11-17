// Photos: read them, and make the two sizes that are stored. Originals are never uploaded.
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

// Why a photo cannot be read, or undefined when it can. Decodes a tiny version, which is cheap
// for JPEG and fails for formats this build cannot decode (iPhone HEIC is issue 12).
export async function whyUnreadable(file: string): Promise<string | undefined> {
  try {
    await sharp(file).resize(16, 16, { fit: 'inside' }).toBuffer()
    return undefined
  } catch (error) {
    return (error as Error).message.replace(/\s+/g, ' ')
  }
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
