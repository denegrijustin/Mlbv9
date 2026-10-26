import { rotate, type Vec } from './vec'

export type Poly = Vec[]

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface Transform {
  x: number
  y: number
  /** Degrees, clockwise-positive on screen. */
  rotation: number
  flipX?: boolean
  flipY?: boolean
}

/** Positive for counter-clockwise in a y-up system, i.e. clockwise on screen (y down). */
export function signedArea(p: Poly): number {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]
    a += p[i].x * q.y - q.x * p[i].y
  }
  return a / 2
}

export const area = (p: Poly): number => Math.abs(signedArea(p))

export function centroid(p: Poly): Vec {
  const a = signedArea(p)
  if (Math.abs(a) < 1e-12) return bboxCenter(bbox(p))
  let cx = 0
  let cy = 0
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]
    const f = p[i].x * q.y - q.x * p[i].y
    cx += (p[i].x + q.x) * f
    cy += (p[i].y + q.y) * f
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

export function bbox(p: Poly): BBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const { x, y } of p) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

export const bboxCenter = (b: BBox): Vec => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 })
export const bboxSize = (b: BBox): { w: number; h: number } => ({ w: b.maxX - b.minX, h: b.maxY - b.minY })

export function unionBBox(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null
  return boxes.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }))
}

/** Ray-casting point-in-polygon. Points exactly on an edge count as inside. */
export function pointInPolygon(pt: Vec, poly: Poly): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    // on-edge check
    const cross = (pt.x - a.x) * (b.y - a.y) - (pt.y - a.y) * (b.x - a.x)
    if (Math.abs(cross) < 1e-9 && pt.x >= Math.min(a.x, b.x) - 1e-9 && pt.x <= Math.max(a.x, b.x) + 1e-9 && pt.y >= Math.min(a.y, b.y) - 1e-9 && pt.y <= Math.max(a.y, b.y) + 1e-9) {
      return true
    }
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Apply flip (about the local origin), then rotation, then translation. */
export function transformPoly(poly: Poly, t: Transform): Poly {
  return poly.map((p) => {
    const local = { x: t.flipX ? -p.x : p.x, y: t.flipY ? -p.y : p.y }
    const r = rotate(local, t.rotation)
    return { x: r.x + t.x, y: r.y + t.y }
  })
}

export function transformPoint(p: Vec, t: Transform): Vec {
  return transformPoly([p], t)[0]
}

export interface Edge {
  a: Vec
  b: Vec
}

export function edgesOf(p: Poly): Edge[] {
  return p.map((a, i) => ({ a, b: p[(i + 1) % p.length] }))
}

export function translatePoly(p: Poly, dx: number, dy: number): Poly {
  return p.map((q) => ({ x: q.x + dx, y: q.y + dy }))
}

export function rectPoly(x: number, y: number, w: number, h: number): Poly {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

/** Rectangle polygon centred on (cx, cy), rotated by `deg`. */
export function rotatedRect(cx: number, cy: number, w: number, h: number, deg: number): Poly {
  return transformPoly(rectPoly(-w / 2, -h / 2, w, h), { x: cx, y: cy, rotation: deg })
}

/** Thick line (wall) as a rectangle around the segment a-b. */
export function thickSegment(a: Vec, b: Vec, thickness: number): Poly {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l = Math.hypot(dx, dy) || 1
  const nx = (-dy / l) * (thickness / 2)
  const ny = (dx / l) * (thickness / 2)
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ]
}
