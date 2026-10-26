import { unionBBox, type BBox } from '../geometry/polygon'
import type { Vec } from '../geometry/vec'
import type { Viewport } from '../store/ui'

export const MIN_ZOOM = 0.4
export const MAX_ZOOM = 48

/** Room inches -> screen pixels. */
export const toScreen = (vp: Viewport, p: Vec): Vec => ({ x: p.x * vp.zoom + vp.panX, y: p.y * vp.zoom + vp.panY })
/** Screen pixels -> room inches. */
export const toWorld = (vp: Viewport, p: Vec): Vec => ({ x: (p.x - vp.panX) / vp.zoom, y: (p.y - vp.panY) / vp.zoom })

/** Zoom by `factor`, keeping the world point under `anchor` (screen px) fixed. */
export function zoomAt(vp: Viewport, factor: number, anchor: Vec): Viewport {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor))
  const k = zoom / vp.zoom
  return { zoom, panX: anchor.x - (anchor.x - vp.panX) * k, panY: anchor.y - (anchor.y - vp.panY) * k }
}

export function fitBBox(box: BBox, size: { w: number; h: number }, padding = 56, maxZoom = 12): Viewport {
  const w = Math.max(1, box.maxX - box.minX)
  const h = Math.max(1, box.maxY - box.minY)
  const zoom = Math.min(maxZoom, Math.max(MIN_ZOOM, Math.min((size.w - padding * 2) / w, (size.h - padding * 2) / h)))
  return {
    zoom,
    panX: (size.w - w * zoom) / 2 - box.minX * zoom,
    panY: (size.h - h * zoom) / 2 - box.minY * zoom,
  }
}

export function centerBBox(vp: Viewport, box: BBox, size: { w: number; h: number }): Viewport {
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  return { zoom: vp.zoom, panX: size.w / 2 - cx * vp.zoom, panY: size.h / 2 - cy * vp.zoom }
}

export { unionBBox }
