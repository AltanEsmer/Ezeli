import exifr from 'exifr'

export type CaptureLocation = { latitude: number; longitude: number }

const tags = ['GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef', 'GPSMapDatum', 'GPSStatus']

function coordinate(parts: unknown, ref: unknown, positive: string, negative: string, limit: number) {
  if (!Array.isArray(parts) || parts.length !== 3 || !parts.every((part) => Number.isFinite(part) && part >= 0)) return
  if (ref !== positive && ref !== negative) return
  const [degrees, minutes, seconds] = parts
  if (minutes >= 60 || seconds >= 60) return
  const value = degrees + minutes / 60 + seconds / 3600
  if (value <= limit) return ref === negative ? -value : value
}

// Read the capture point from the original, before any image conversion drops its EXIF.
export async function captureLocation(original: Uint8Array | Blob): Promise<CaptureLocation | undefined> {
  try {
    const gps = await exifr.parse(original, { tiff: false, gps: { pick: tags, translateValues: false } })
    if (!gps || (gps.GPSStatus && gps.GPSStatus !== 'A')) return
    if (gps.GPSMapDatum && !/^WGS[ -]?84$/i.test(gps.GPSMapDatum)) return
    const latitude = coordinate(gps.GPSLatitude, gps.GPSLatitudeRef, 'N', 'S', 90)
    const longitude = coordinate(gps.GPSLongitude, gps.GPSLongitudeRef, 'E', 'W', 180)
    if (latitude !== undefined && longitude !== undefined) return { latitude, longitude }
  } catch {
    // Unreadable or unsupported metadata does not prevent an otherwise readable photo being saved.
  }
}
