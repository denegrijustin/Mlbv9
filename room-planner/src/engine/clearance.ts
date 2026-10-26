import { bbox, centroid, transformPoly, type Poly } from '../geometry/polygon'
import { closestPolyPoly, closestPolySeg } from '../geometry/distance'
import { intersect, subtract } from '../geometry/clip'
import { lDeskOverallDepth } from '../geometry/shapes'
import { add, rotate, mul, type Vec } from '../geometry/vec'
import type { ClearanceRules, FurnitureItem } from '../model/types'
import { OVERLAP_TOLERANCE, type Collision } from './collisions'
import { furniturePolygon } from './scene'
import { interiorWallPolygon, type Architecture } from './room'

/** Gaps at or below this (inches) read as "flush": the object is up against the surface. */
export const FLUSH_TOLERANCE = 0.25

export type ClearanceStatus = 'collision' | 'tight' | 'good' | 'flush'
export type ClearanceKind = 'wall' | 'interior-wall' | 'window' | 'door' | 'door-swing' | 'pillar' | 'builtin' | 'furniture'

export interface ClearanceEntry {
  id: string
  label: string
  kind: ClearanceKind
  distance: number
  status: ClearanceStatus
  /** Nearest point on the selected object. */
  from: Vec
  /** Nearest point on the thing it is measured to. */
  to: Vec
  note?: string
}

export function classifyGap(distance: number, rules: ClearanceRules): ClearanceStatus {
  if (distance <= FLUSH_TOLERANCE) return 'flush'
  return distance >= rules.comfortablePath ? 'good' : 'tight'
}

export function gapNote(distance: number, rules: ClearanceRules): string | undefined {
  if (distance <= FLUSH_TOLERANCE) return undefined
  if (distance < rules.walkingPath) return `Narrower than the ${rules.walkingPath}" minimum walking path`
  if (distance < rules.comfortablePath) return `Below the ${rules.comfortablePath}" comfortable path`
  return undefined
}

const NEAR = 120 // only list non-wall neighbours within this many inches

export interface ClearanceContext {
  arch: Architecture
  furniture: FurnitureItem[]
  rules: ClearanceRules
}

/** Nearest distances from a footprint to everything around it, nearest first. */
export function computeClearances(selfId: string | null, poly: Poly, ctx: ClearanceContext, collisions: Collision[]): ClearanceEntry[] {
  const { arch, furniture, rules } = ctx
  const out: ClearanceEntry[] = []
  const hit = new Map(collisions.map((c) => [c.obstacleId, c]))
  const outsideRoom = hit.has('room')

  const push = (e: Omit<ClearanceEntry, 'status' | 'note'> & { forceCollision?: boolean }) => {
    const { forceCollision, ...rest } = e
    if (forceCollision) {
      out.push({ ...rest, distance: 0, status: 'collision' })
      return
    }
    out.push({ ...rest, status: classifyGap(rest.distance, rules), note: gapNote(rest.distance, rules) })
  }

  for (const w of arch.room.walls) {
    if (w.kind === 'perimeter') {
      const c = closestPolySeg(poly, w.a, w.b)
      push({ id: w.id, label: w.name, kind: 'wall', distance: c.dist, from: c.p, to: c.q, forceCollision: outsideRoom && c.dist < 1e-6 })
    } else {
      const c = closestPolyPoly(poly, interiorWallPolygon(w))
      push({ id: w.id, label: w.name, kind: 'interior-wall', distance: c.dist, from: c.p, to: c.q, forceCollision: hit.has(w.id) })
    }
  }

  for (const a of arch.arch) {
    if (!a.placed) continue
    if (a.type === 'window' && a.segment) {
      const c = closestPolySeg(poly, a.segment.a, a.segment.b)
      if (c.dist <= NEAR) push({ id: a.id, label: a.item.name, kind: 'window', distance: c.dist, from: c.p, to: c.q })
    } else if (a.type === 'door') {
      if (a.segment) {
        const c = closestPolySeg(poly, a.segment.a, a.segment.b)
        if (c.dist <= NEAR) push({ id: a.id, label: a.item.name, kind: 'door', distance: c.dist, from: c.p, to: c.q })
      }
      if (a.swingZone) {
        const key = `${a.id}:swing`
        const c = closestPolyPoly(poly, a.swingZone)
        const blocked = rules.keepDoorSwingClear && hit.has(key)
        if (c.dist <= NEAR || blocked) {
          push({ id: key, label: `${a.item.name} swing`, kind: 'door-swing', distance: c.dist, from: c.p, to: c.q, forceCollision: blocked })
        }
      }
    } else if ((a.type === 'pillar' || a.type === 'builtin') && a.polygon) {
      const c = closestPolyPoly(poly, a.polygon)
      if (c.dist <= NEAR || hit.has(a.id)) push({ id: a.id, label: a.item.name, kind: a.type, distance: c.dist, from: c.p, to: c.q, forceCollision: hit.has(a.id) })
    }
  }

  for (const f of furniture) {
    if (f.id === selfId || f.hidden || !f.collides) continue
    const fp = furniturePolygon(f)
    const c = closestPolyPoly(poly, fp)
    if (c.dist <= NEAR || hit.has(f.id)) push({ id: f.id, label: f.name, kind: 'furniture', distance: c.dist, from: c.p, to: c.q, forceCollision: hit.has(f.id) })
  }

  return out.sort((a, b) => a.distance - b.distance)
}

// ---------------------------------------------------------------- chair / working clearance

export interface WorkEdge {
  a: Vec
  b: Vec
  /** Unit normal pointing away from the object, toward where a person sits. */
  n: Vec
}

/** Working edges of a desk in room coordinates (local geometry, then the object's flip, rotation and position). */
export function workEdges(item: FurnitureItem): WorkEdge[] {
  const local: Array<{ a: Vec; b: Vec; n: Vec }> = []
  if (item.workSide === 'front') {
    local.push({ a: { x: -item.width / 2, y: item.depth / 2 }, b: { x: item.width / 2, y: item.depth / 2 }, n: { x: 0, y: 1 } })
  } else if (item.workSide === 'ldesk' && item.shape.kind === 'ldesk') {
    const s = item.shape
    const L = s.mainLength
    const Dm = s.mainDepth
    const R = lDeskOverallDepth(s)
    const Wr = s.returnWidth
    const r = Math.min(Math.max(0, s.innerRadius), Math.max(0, Math.min(L - Wr, R - Dm)))
    const c = { x: L / 2, y: R / 2 }
    const left = s.returnSide === 'left'
    // Underside of the main run, and the inner face of the return.
    const e1 = left ? { a: { x: Wr + r, y: Dm }, b: { x: L, y: Dm } } : { a: { x: 0, y: Dm }, b: { x: L - Wr - r, y: Dm } }
    const e2x = left ? Wr : L - Wr
    const e2 = { a: { x: e2x, y: Dm + r }, b: { x: e2x, y: R } }
    local.push({ ...e1, n: { x: 0, y: 1 } })
    local.push({ ...e2, n: { x: left ? 1 : -1, y: 0 } })
    for (const e of local) {
      e.a = { x: e.a.x - c.x, y: e.a.y - c.y }
      e.b = { x: e.b.x - c.x, y: e.b.y - c.y }
    }
  }
  const t = { x: item.x, y: item.y, rotation: item.rotation, flipX: item.flipX, flipY: item.flipY }
  return local.map((e) => {
    const [a, b] = transformPoly([e.a, e.b], t)
    const nf = { x: item.flipX ? -e.n.x : e.n.x, y: item.flipY ? -e.n.y : e.n.y }
    return { a, b, n: rotate(nf, item.rotation) }
  })
}

export interface ChairZone {
  zones: Array<{ polygon: Poly; free: number; status: ClearanceStatus; a: Vec; b: Vec; n: Vec }>
  /** The smallest free depth across all working edges. */
  free: number
  required: number
  status: ClearanceStatus
}

const extrude = (a: Vec, b: Vec, n: Vec, d: number): Poly => {
  const o = mul(n, d)
  return [a, b, add(b, o), add(a, o)]
}

/**
 * How much clear floor is there in front of the desk's working edges, up to the required chair clearance.
 * `obstacles` must already exclude the desk itself (and normally chairs).
 */
export function computeChairZone(
  item: FurnitureItem,
  obstacles: Array<{ polygon: Poly; box: ReturnType<typeof bbox> }>,
  roomPolygon: Poly,
  rules: ClearanceRules,
): ChairZone | null {
  const edges = workEdges(item)
  if (edges.length === 0) return null
  const required = rules.chairClearance
  const blockedAt = (e: WorkEdge, d: number): boolean => {
    const z = extrude(e.a, e.b, e.n, d)
    if (subtract(z, roomPolygon).area > OVERLAP_TOLERANCE) return true
    const zb = bbox(z)
    for (const o of obstacles) {
      if (zb.minX >= o.box.maxX || zb.maxX <= o.box.minX || zb.minY >= o.box.maxY || zb.maxY <= o.box.minY) continue
      if (intersect(z, o.polygon).area > OVERLAP_TOLERANCE) return true
    }
    return false
  }
  const zones = edges.map((e) => {
    let free = required
    if (blockedAt(e, required)) {
      let lo = 0
      let hi = required
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2
        if (blockedAt(e, mid)) hi = mid
        else lo = mid
      }
      free = lo
    }
    const status: ClearanceStatus = free >= required - 1e-6 ? 'good' : free >= rules.walkingPath ? 'tight' : 'collision'
    return { polygon: extrude(e.a, e.b, e.n, required), free, status, a: e.a, b: e.b, n: e.n }
  })
  const free = Math.min(...zones.map((z) => z.free))
  const rank: Record<ClearanceStatus, number> = { good: 0, flush: 0, tight: 1, collision: 2 }
  const status = zones.reduce<ClearanceStatus>((worst, z) => (rank[z.status] > rank[worst] ? z.status : worst), 'good')
  return { zones, free, required, status }
}

export { centroid }
