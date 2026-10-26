import { clamp, type Vec } from './vec'
import { edgesOf, type Poly } from './polygon'

export interface Closest {
  dist: number
  /** Closest point on the first shape. */
  p: Vec
  /** Closest point on the second shape. */
  q: Vec
}

/** Closest points between segments a-b and c-d (Ericson, Real-Time Collision Detection). */
export function closestSegSeg(a: Vec, b: Vec, c: Vec, d: Vec): Closest {
  const d1x = b.x - a.x
  const d1y = b.y - a.y
  const d2x = d.x - c.x
  const d2y = d.y - c.y
  const rx = a.x - c.x
  const ry = a.y - c.y
  const A = d1x * d1x + d1y * d1y
  const E = d2x * d2x + d2y * d2y
  const F = d2x * rx + d2y * ry
  const EPS = 1e-12
  let s: number
  let t: number
  if (A <= EPS && E <= EPS) {
    s = 0
    t = 0
  } else if (A <= EPS) {
    s = 0
    t = clamp(F / E, 0, 1)
  } else {
    const C = d1x * rx + d1y * ry
    if (E <= EPS) {
      t = 0
      s = clamp(-C / A, 0, 1)
    } else {
      const B = d1x * d2x + d1y * d2y
      const denom = A * E - B * B
      s = denom > EPS ? clamp((B * F - C * E) / denom, 0, 1) : 0
      t = (B * s + F) / E
      if (t < 0) {
        t = 0
        s = clamp(-C / A, 0, 1)
      } else if (t > 1) {
        t = 1
        s = clamp((B - C) / A, 0, 1)
      }
    }
  }
  const p = { x: a.x + d1x * s, y: a.y + d1y * s }
  const q = { x: c.x + d2x * t, y: c.y + d2y * t }
  return { dist: Math.hypot(p.x - q.x, p.y - q.y), p, q }
}

export function closestPointOnSegment(pt: Vec, a: Vec, b: Vec): Vec {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (l2 < 1e-12) return { ...a }
  const t = clamp(((pt.x - a.x) * dx + (pt.y - a.y) * dy) / l2, 0, 1)
  return { x: a.x + dx * t, y: a.y + dy * t }
}

/** Minimum edge-to-edge distance between two polygon outlines (0 if the outlines touch or cross). */
export function closestPolyPoly(P: Poly, Q: Poly): Closest {
  let best: Closest = { dist: Infinity, p: P[0], q: Q[0] }
  const pe = edgesOf(P)
  const qe = edgesOf(Q)
  for (const e of pe) {
    for (const f of qe) {
      const c = closestSegSeg(e.a, e.b, f.a, f.b)
      if (c.dist < best.dist) best = c
      if (best.dist === 0) return best
    }
  }
  return best
}

/** Closest points between a polygon outline and a segment. */
export function closestPolySeg(P: Poly, a: Vec, b: Vec): Closest {
  let best: Closest = { dist: Infinity, p: P[0], q: a }
  for (const e of edgesOf(P)) {
    const c = closestSegSeg(e.a, e.b, a, b)
    if (c.dist < best.dist) best = c
    if (best.dist === 0) return best
  }
  return best
}
