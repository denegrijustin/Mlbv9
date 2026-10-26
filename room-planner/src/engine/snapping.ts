import type { BBox } from '../geometry/polygon'
import { angleDiff, roundTo, wrapDeg } from '../geometry/vec'
import type { ResolvedRoom } from './room'

export type SnapKind = 'wall' | 'butt' | 'align' | 'center' | 'grid'

export interface SnapOptions {
  enabled: boolean
  walls: boolean
  edges: boolean
  centers: boolean
  /** 0 = grid snapping off. */
  grid: number
  /** Magnetic distance in inches. */
  threshold: number
}

export interface SnapTarget {
  id: string
  box: BBox
}

export interface Guide {
  axis: 'x' | 'y'
  /** The coordinate of the guide line (x for a vertical guide, y for a horizontal one). */
  value: number
  from: number
  to: number
  kind: SnapKind
}

export interface SnapResult {
  dx: number
  dy: number
  guides: Guide[]
  snappedX: SnapKind | null
  snappedY: SnapKind | null
}

interface Candidate {
  delta: number
  kind: SnapKind
  guide: Guide | null
}

const PRIORITY: Record<SnapKind, number> = { wall: 0, butt: 1, align: 2, center: 3, grid: 4 }
const TIE = 0.01

function axisCandidates(axis: 'x' | 'y', b: BBox, room: ResolvedRoom, targets: SnapTarget[], o: SnapOptions): Candidate[] {
  const lo = axis === 'x' ? b.minX : b.minY
  const hi = axis === 'x' ? b.maxX : b.maxY
  const mid = (lo + hi) / 2
  const oLo = axis === 'x' ? b.minY : b.minX
  const oHi = axis === 'x' ? b.maxY : b.maxX
  const out: Candidate[] = []
  const g = (kind: SnapKind, value: number, from: number, to: number): Guide => ({ axis, value, from, to, kind })

  if (o.walls) {
    for (const w of room.walls) {
      if (w.kind !== 'perimeter') continue
      // A wall constrains this axis when it runs perpendicular to it: x snaps to walls that run along y.
      const runsAlong = axis === 'x' ? Math.abs(w.dir.x) < 1e-9 : Math.abs(w.dir.y) < 1e-9
      if (!runsAlong) continue
      const at = axis === 'x' ? w.a.x : w.a.y
      const n = axis === 'x' ? w.normalIn.x : w.normalIn.y
      const wFrom = axis === 'x' ? Math.min(w.a.y, w.b.y) : Math.min(w.a.x, w.b.x)
      const wTo = axis === 'x' ? Math.max(w.a.y, w.b.y) : Math.max(w.a.x, w.b.x)
      if (oHi < wFrom - o.threshold || oLo > wTo + o.threshold) continue
      // Flush means the object's face toward the wall touches it, with the object on the room side.
      const edge = n > 0 ? lo : hi
      out.push({ delta: at - edge, kind: 'wall', guide: null })
    }
    if (axis === 'x' && room.width !== null && o.centers) out.push({ delta: room.width / 2 - mid, kind: 'center', guide: g('center', room.width / 2, oLo - 12, oHi + 12) })
    if (axis === 'y' && room.depth !== null && o.centers) out.push({ delta: room.depth / 2 - mid, kind: 'center', guide: g('center', room.depth / 2, oLo - 12, oHi + 12) })
  }

  for (const t of targets) {
    const tLo = axis === 'x' ? t.box.minX : t.box.minY
    const tHi = axis === 'x' ? t.box.maxX : t.box.maxY
    const tMid = (tLo + tHi) / 2
    const tOLo = axis === 'x' ? t.box.minY : t.box.minX
    const tOHi = axis === 'x' ? t.box.maxY : t.box.maxX
    const from = Math.min(oLo, tOLo)
    const to = Math.max(oHi, tOHi)
    if (o.edges) {
      const overlaps = oLo < tOHi + o.threshold && oHi > tOLo - o.threshold
      if (overlaps) {
        out.push({ delta: tLo - hi, kind: 'butt', guide: g('butt', tLo, from, to) })
        out.push({ delta: tHi - lo, kind: 'butt', guide: g('butt', tHi, from, to) })
      }
      out.push({ delta: tLo - lo, kind: 'align', guide: g('align', tLo, from, to) })
      out.push({ delta: tHi - hi, kind: 'align', guide: g('align', tHi, from, to) })
    }
    if (o.centers) out.push({ delta: tMid - mid, kind: 'center', guide: g('center', tMid, from, to) })
  }
  return out
}

/**
 * Magnetic snapping for a proposed footprint position. `box` is the bounding box of the footprint at the proposed
 * position. Returns the correction (dx, dy) to apply and the guides to draw.
 */
export function snapMove(box: BBox, room: ResolvedRoom, targets: SnapTarget[], o: SnapOptions): SnapResult {
  const result: SnapResult = { dx: 0, dy: 0, guides: [], snappedX: null, snappedY: null }
  if (!o.enabled) return result
  for (const axis of ['x', 'y'] as const) {
    const cands = axisCandidates(axis, box, room, targets, o).filter((c) => Math.abs(c.delta) <= o.threshold + 1e-9)
    let delta = 0
    let kind: SnapKind | null = null
    if (cands.length > 0) {
      cands.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || PRIORITY[a.kind] - PRIORITY[b.kind])
      const best = cands[0]
      delta = best.delta
      kind = best.kind
      for (const c of cands) {
        if (Math.abs(c.delta - best.delta) <= TIE && c.guide) result.guides.push(c.guide)
      }
    } else if (o.grid > 0) {
      const lo = axis === 'x' ? box.minX : box.minY
      delta = roundTo(lo, o.grid) - lo
      kind = 'grid'
    }
    if (axis === 'x') {
      result.dx = delta
      result.snappedX = kind
    } else {
      result.dy = delta
      result.snappedY = kind
    }
  }
  // Re-anchor guides to the snapped position along the other axis so lines span the final object.
  return result
}

/**
 * Snap an angle. step > 0 snaps to multiples of step. step = 0 is free rotation, with a gentle 2 degree pull
 * onto the right angles unless `soft` is false.
 */
export function snapAngle(deg: number, step: number, soft = true): number {
  const a = wrapDeg(deg)
  if (step > 0) return wrapDeg(Math.round(a / step) * step) % 360
  if (soft) {
    for (const k of [0, 90, 180, 270, 360]) {
      if (Math.abs(angleDiff(a, k)) <= 2) return k % 360
    }
  }
  return Math.round(a * 10) / 10
}
