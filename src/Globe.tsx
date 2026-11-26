import { geoDistance, geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import land from './globe-land.json'
import { t } from './i18n.ts'
import { maxZoom, panCamera, useGlobeCamera, zoomCamera, type GlobeView, type Point } from './globeCamera.ts'
import { Shot, useLinks, useNear } from './MemoryItem.tsx'
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
const world = { center: [20, 25] as Point, zoom: 1 }
const side = 1000
const position = (photo: LocatedPhoto): Point => [photo.longitude, photo.latitude]

export default function Globe({ onSessionLost, entry, views }: { onSessionLost: () => void; entry: string; views: Map<string, GlobeView> }) {
  const [view] = useState(() => views.get(entry) ?? {})
  useEffect(() => { views.set(entry, view) }, [entry, view, views])
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
  return <Atlas photos={photos} view={view} />
}

type Marker = { x: number; y: number; photos: LocatedPhoto[] }
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
const arrows: Record<string, Point> = { ArrowLeft: [32, 0], ArrowRight: [-32, 0], ArrowUp: [0, 32], ArrowDown: [0, -32] }

function Atlas({ photos, view }: { photos: LocatedPhoto[]; view: GlobeView }) {
  const overview = photos[0] ? { center: position(photos[0]), zoom: 1 } : world
  const { camera, target, change } = useGlobeCamera(overview, view)
  const [selected, setSelected] = useState(() => new Set(view.selected))
  const pointers = useRef(new Map<number, Point>())
  const map = useRef<SVGSVGElement>(null)
  const choices = photos.filter((photo) => selected.has(photo.message_id))
  const senderCounts = new Map<string, number>()
  for (const photo of choices) senderCounts.set(photo.display_name, (senderCounts.get(photo.display_name) ?? 0) + 1)
  const places = useMemo(() => [...new Map(photos.map((photo) => [position(photo).join(','), position(photo)])).values()], [photos])

  const zoom = (factor: number, animate = false) => change(zoomCamera(target(), factor), animate)
  const wheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault()
    zoom(Math.exp(Math.max(-75, Math.min(75, -event.deltaY)) * 0.004))
  })
  useEffect(() => {
    const node = map.current
    const listen = (event: WheelEvent) => wheel(event)
    node?.addEventListener('wheel', listen, { passive: false })
    return () => node?.removeEventListener('wheel', listen)
  }, [])

  const projection = useMemo(() => geoOrthographic()
    .translate([side / 2, side / 2])
    .scale(side * 0.46 * camera.zoom)
    .rotate([-camera.center[0], -camera.center[1]])
    .clipExtent([[0, 0], [side, side]]), [camera])
  const shapes = useMemo(() => {
    const draw = geoPath(projection)
    return { earth: draw({ type: 'Sphere' }), grid: draw(graticule), land: draw(coastline) }
  }, [projection])

  const markers: Marker[] = []
  for (const photo of photos) {
    const point = position(photo)
    if (geoDistance(camera.center, point) >= Math.PI / 2) continue
    const [x, y] = projection(point)!
    if (x < 22 || x > side - 22 || y < 22 || y > side - 22) continue
    // A cluster's first photo anchors it. Keep 44px hit targets apart on the smallest phone.
    const nearby = markers.find((marker) => Math.hypot(marker.x - x, marker.y - y) < 155)
    if (nearby) nearby.photos.push(photo)
    else markers.push({ x, y, photos: [photo] })
  }

  const choose = (group: LocatedPhoto[]) => {
    view.selected = group.map((photo) => photo.message_id)
    setSelected(new Set(view.selected))
  }
  const nextPlace = () => {
    const current = places.findIndex((point) => distance(point, target().center) === 0)
    change({ ...target(), center: places[(current + 1) % places.length]! }, true)
  }

  return <div className="globe">
    <header>
      <h1>{t.globe}</h1>
      <p>{photos.length ? t.globeCount(String(photos.length)) : t.globeEmpty}</p>
    </header>
    <div className="globe-stage">
      <svg ref={map} viewBox={`0 0 ${side} ${side}`} role="img" aria-label={t.globeMap}
        tabIndex={0} aria-description={t.globeKeys}
        onKeyDown={(event) => {
          const arrow = arrows[event.key]
          if (!arrow || event.altKey || event.ctrlKey || event.metaKey) return
          event.preventDefault()
          change(panCamera(target(), ...arrow, event.currentTarget.clientWidth))
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || pointers.current.size >= 2) return
          change(camera)
          pointers.current.set(event.pointerId, [event.clientX, event.clientY])
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const previous = pointers.current.get(event.pointerId)
          if (!previous) return
          const point: Point = [event.clientX, event.clientY]
          const other = [...pointers.current].find(([id]) => id !== event.pointerId)?.[1]
          pointers.current.set(event.pointerId, point)
          if (other) zoom(distance(point, other) / Math.max(1, distance(previous, other)))
          else change(panCamera(target(), point[0] - previous[0], point[1] - previous[1], event.currentTarget.clientWidth))
        }}
        onLostPointerCapture={(event) => { pointers.current.delete(event.pointerId) }}
      >
        <path className="globe-earth" d={shapes.earth ?? undefined} />
        <path className="globe-land" d={shapes.land ?? undefined} />
        <path className="globe-grid" d={shapes.grid ?? undefined} />
      </svg>
      {markers.map(({ x, y, photos: group }) => <button key={group[0]!.message_id} className="globe-pin"
        aria-label={group.length === 1 ? t.photoBy(group[0]!.display_name) : t.globeArea(String(group.length))}
        aria-pressed={group.every((photo) => selected.has(photo.message_id))} onClick={() => choose(group)}
        style={{ left: `${x * 100 / side}%`, top: `${y * 100 / side}%` }}>
        <span aria-hidden="true">{group.length > 1 && group.length}</span>
      </button>)}
    </div>
    <div className="globe-controls">
      <button aria-label={t.zoomOut} disabled={camera.zoom === 1} onClick={() => zoom(1 / 1.7, true)}>−</button>
      <button aria-label={t.zoomIn} disabled={camera.zoom === maxZoom} onClick={() => zoom(1.7, true)}>+</button>
      <button onClick={() => { change(overview, true); choose([]) }}>{t.globeReset}</button>
      {places.length > 1 && <button onClick={nextPlace}>{t.globeNext}</button>}
    </div>
    {choices.length > 0 && <section className="globe-choices" aria-label={t.globeArea(String(choices.length))}>
      {choices.map((photo, index) => <Preview photo={photo} key={photo.message_id}
        number={senderCounts.get(photo.display_name)! > 1 ? index + 1 : undefined} />)}
    </section>}
  </div>
}

function Preview({ photo, number }: { photo: LocatedPhoto; number?: number }) {
  const ref = useRef<HTMLAnchorElement>(null)
  const near = useNear(ref)
  const [thumb] = useLinks(near ? [photo.thumb_path] : [])
  const path = memoryPath(photo.memory_key)
  const [before, after] = t.openLocatedPhoto('\0').split('\0')
  return <a ref={ref} className="globe-preview" href={`${path}#photo=${photo.message_id}`} onClick={follow(path, { path: globePath, photo: photo.message_id })}>
    <Shot url={thumb} ratio={4 / 3} alt={t.photoBy(photo.display_name)} />
    <span>{before}<span lang="tr">{photo.display_name}</span>{after}{number && ` · ${number}`}</span>
  </a>
}
