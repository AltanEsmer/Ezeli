import { geoInterpolate } from 'd3-geo'
import { useEffect, useRef, useState } from 'react'

export type Point = [number, number]
type Camera = { center: Point; zoom: number }
export type GlobeView = { camera?: Camera; selected?: string[] }

export const maxZoom = 35
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
export const zoomCamera = (camera: Camera, factor: number): Camera =>
  ({ ...camera, zoom: clamp(camera.zoom * factor, 1, maxZoom) })
export const panCamera = ({ center: [lon, lat], zoom }: Camera, dx: number, dy: number, width: number): Camera => {
  const degrees = 150 / (width * zoom)
  return { center: [(lon - dx * degrees) % 360, clamp(lat + dy * degrees, -90, 90)], zoom }
}

export function useGlobeCamera(overview: Camera, view: GlobeView) {
  const target = () => view.camera ?? overview
  const [camera, setCamera] = useState(target)
  const shown = useRef(camera)
  const frame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  const change = (next: Camera, animate = false) => {
    cancelAnimationFrame(frame.current)
    view.camera = next
    const show = (value: Camera) => {
      shown.current = value
      setCamera(value)
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    if (!animate || reduced.matches) return show(next)
    const from = shown.current
    const center = geoInterpolate(from.center, next.center)
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 180)
      if (t === 1 || reduced.matches) return show(next)
      const progress = t * (2 - t)
      show({ center: center(progress), zoom: from.zoom + (next.zoom - from.zoom) * progress })
      frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }
  return { camera, target, change }
}
