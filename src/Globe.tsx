import { geoDistance, geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import { useEffect, useMemo, useRef, useState } from 'react'
import land from './globe-land.json'
import { t } from './i18n.ts'
import { Shot, useLinks } from './MemoryItem.tsx'
import { GlobeUnavailable } from './GlobeUnavailable.tsx'
import { follow, globePath, memoryPath } from './route.ts'
import { supabase } from './supabase.ts'
import './styles/globe.css'

type LocatedPhoto = {
  message_id: string
  memory_key: string
  latitude: number
  longitude: number
  thumb_path: string
  display_name: string
}

// Natural Earth 1:110m land, v5.1.2. Public domain, shipped with Ezeli.
// https://www.naturalearthdata.com/downloads/110m-physical-vectors/
const coastline = land as GeoPermissibleObjects
const graticule = geoGraticule10()
const world = { center: [20, 25] as [number, number], zoom: 1 }
const side = 1000
const position = (photo: LocatedPhoto): [number, number] => [photo.longitude, photo.latitude]

export default function Globe({ onSessionLost }: { onSessionLost: () => void }) {
  const [photos, setPhotos] = useState<LocatedPhoto[] | 'failed' | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { window.scrollTo(0, 0) }, [])
  useEffect(() => {
    const abort = new AbortController()
    void (async () => {
      try {
        const found: LocatedPhoto[] = []
        const pageSize = 500
        for (let start = 0; ; start += pageSize) {
          const page = await supabase.from('located_photos').select('*').order('message_id')
            .range(start, start + pageSize - 1).abortSignal(abort.signal)
          if (page.error) throw page.error
          found.push(...page.data)
          if (page.data.length < pageSize) break
        }
        if (!found.length && !abort.signal.aborted) {
          const who = await supabase.rpc('current_person').abortSignal(abort.signal)
          if (who.error) throw who.error
          if (!who.data[0] && !abort.signal.aborted) return onSessionLost()
        }
        if (!abort.signal.aborted) setPhotos(found)
      } catch {
        if (!abort.signal.aborted) setPhotos('failed')
      }
    })()
    return () => abort.abort()
  }, [attempt, onSessionLost])

  if (photos === 'failed') return <GlobeUnavailable retry={() => {
    setPhotos(null)
    setAttempt((value) => value + 1)
  }} />
  if (photos === null) return <div aria-busy="true" aria-label={t.loading} />
  return <Atlas photos={photos} />
}

function Atlas({ photos }: { photos: LocatedPhoto[] }) {
  const overview = photos[0] ? { center: position(photos[0]), zoom: 1 } : world
  const [camera, setCamera] = useState(overview)
  const [selected, setSelected] = useState<LocatedPhoto | null>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)

  const projection = useMemo(() => geoOrthographic()
    .translate([side / 2, side / 2])
    .scale(side * 0.46 * camera.zoom)
    .rotate([-camera.center[0], -camera.center[1]])
    .clipExtent([[0, 0], [side, side]]), [camera])
  const shapes = useMemo(() => {
    const draw = geoPath(projection)
    return { earth: draw({ type: 'Sphere' }), grid: draw(graticule), land: draw(coastline) }
  }, [projection])

  const zoom = (factor: number) => setCamera((value) => ({ ...value, zoom: Math.max(1, Math.min(35, value.zoom * factor)) }))
  const move = (x: number, y: number, width: number) => setCamera(({ center: [lon, lat], zoom }) => {
    const degrees = 150 / (width * zoom)
    return { center: [(lon - x * degrees) % 360, Math.max(-90, Math.min(90, lat + y * degrees))], zoom }
  })

  return <div className="globe">
    <header>
      <h1>{t.globe}</h1>
      <p>{photos.length ? t.globeCount(String(photos.length)) : t.globeEmpty}</p>
    </header>
    <div className="globe-stage">
      <svg viewBox={`0 0 ${side} ${side}`} role="img" aria-label={t.globeMap}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return
          drag.current = { x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!event.isPrimary || !drag.current) return
          move(event.clientX - drag.current.x, event.clientY - drag.current.y, event.currentTarget.clientWidth)
          drag.current = { x: event.clientX, y: event.clientY }
        }}
        onLostPointerCapture={() => { drag.current = null }}
      >
        <path className="globe-earth" d={shapes.earth ?? undefined} />
        <path className="globe-land" d={shapes.land ?? undefined} />
        <path className="globe-grid" d={shapes.grid ?? undefined} />
      </svg>
      {photos.map((photo) => {
        const point = position(photo)
        if (geoDistance(camera.center, point) >= Math.PI / 2) return null
        const [x, y] = projection(point)!
        if (x < 22 || x > side - 22 || y < 22 || y > side - 22) return null
        return <button key={photo.message_id} className="globe-pin" aria-label={t.photoBy(photo.display_name)}
          aria-pressed={photo === selected} onClick={() => setSelected(photo)}
          style={{ left: `${x * 100 / side}%`, top: `${y * 100 / side}%` }} />
      })}
    </div>
    <div className="globe-controls">
      <button aria-label={t.zoomOut} disabled={camera.zoom === 1} onClick={() => zoom(1 / 1.7)}>−</button>
      <button aria-label={t.zoomIn} disabled={camera.zoom === 35} onClick={() => zoom(1.7)}>+</button>
      <button onClick={() => setCamera(overview)}>{t.globeReset}</button>
    </div>
    {selected && <Preview photo={selected} key={selected.message_id} />}
  </div>
}

function Preview({ photo }: { photo: LocatedPhoto }) {
  const [thumb] = useLinks([photo.thumb_path])
  const path = memoryPath(photo.memory_key)
  return <a className="globe-preview" href={path} onClick={follow(path, { path: globePath, photo: photo.message_id })}>
    <Shot url={thumb} ratio={4 / 3} alt={t.photoBy(photo.display_name)} />
    <span>{t.openLocatedPhoto(photo.display_name)}</span>
  </a>
}
