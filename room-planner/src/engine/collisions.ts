import { bbox, type BBox, type Poly } from '../geometry/polygon'
import { intersect, subtract } from '../geometry/clip'
import type { Vec } from '../geometry/vec'
import type { Obstacle, ObstacleKind } from './scene'

/** Overlaps smaller than this (square inches) count as touching, not colliding. Keeps flush placement clean. */
export const OVERLAP_TOLERANCE = 0.05

export interface Collision {
  obstacleId: string
  kind: ObstacleKind | 'wall'
  label: string
  area: number
  /** Outline(s) of the overlapping region, for highlighting. */
  outlines: Poly[]
}

const boxesOverlap = (a: BBox, b: BBox) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY

export function findCollisions(poly: Poly, obstacles: Obstacle[], roomPolygon: Poly): Collision[] {
  const out: Collision[] = []
  const b = bbox(poly)
  const outside = subtract(poly, roomPolygon)
  if (outside.area > OVERLAP_TOLERANCE) {
    out.push({ obstacleId: 'room', kind: 'wall', label: 'Wall', area: outside.area, outlines: outside.outlines })
  }
  for (const o of obstacles) {
    if (!boxesOverlap(b, o.box)) continue
    const hit = intersect(poly, o.polygon)
    if (hit.area > OVERLAP_TOLERANCE) {
      out.push({ obstacleId: o.id, kind: o.kind, label: o.label, area: hit.area, outlines: hit.outlines })
    }
  }
  return out
}

export const hasCollision = (poly: Poly, obstacles: Obstacle[], roomPolygon: Poly): boolean => findCollisions(poly, obstacles, roomPolygon).length > 0

/**
 * "Prevent overlap" movement. Try the full move, then slide along each axis, then stop at first contact along the path.
 * `collides(p)` says whether the object at position p would collide.
 */
export function constrainMove(candidate: Vec, prev: Vec, collides: (p: Vec) => boolean): Vec {
  if (!collides(candidate)) return candidate
  const slideX = { x: candidate.x, y: prev.y }
  const slideY = { x: prev.x, y: candidate.y }
  const okX = !collides(slideX)
  const okY = !collides(slideY)
  if (okX && okY) {
    const dx = Math.abs(candidate.x - prev.x)
    const dy = Math.abs(candidate.y - prev.y)
    return dx >= dy ? slideX : slideY
  }
  if (okX) return slideX
  if (okY) return slideY
  // Stop at first contact along the straight path.
  let lo = 0
  let hi = 1
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2
    const p = { x: prev.x + (candidate.x - prev.x) * mid, y: prev.y + (candidate.y - prev.y) * mid }
    if (collides(p)) hi = mid
    else lo = mid
  }
  return { x: prev.x + (candidate.x - prev.x) * lo, y: prev.y + (candidate.y - prev.y) * lo }
}
