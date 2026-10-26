/** Helpers for rooms whose floor is a user-drawn polygon rather than a width x depth rectangle. */
import { bbox, signedArea, type Poly } from './polygon'
import { add, cross, mul, norm, sub, type Vec } from './vec'

/** Vertices ordered clockwise on screen (the orientation the planner's wall maths assumes). */
export function orientClockwise(p: Poly): Poly {
  return signedArea(p) < 0 ? [...p].reverse() : p
}

/** Inward unit normal of the edge a→b for a clockwise-on-screen polygon. */
export function inwardNormal(a: Vec, b: Vec): Vec {
  const d = norm(sub(b, a))
  return { x: -d.y, y: d.x }
}

function segmentsCross(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = cross(sub(b, a), sub(c, a))
  const d2 = cross(sub(b, a), sub(d, a))
  const d3 = cross(sub(d, c), sub(a, c))
  const d4 = cross(sub(d, c), sub(b, c))
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9
}

export interface OutlineProblem {
  message: string
  /** Indices of the vertices involved. */
  vertices: number[]
}

/** Reasons the outline cannot be a room floor: too few points, a zero-length edge, or edges that cross. */
export function validateOutline(p: Poly): OutlineProblem[] {
  const out: OutlineProblem[] = []
  if (p.length < 3) return [{ message: 'A room needs at least 3 corners.', vertices: [] }]
  const n = p.length
  for (let i = 0; i < n; i++) {
    const a = p[i]
    const b = p[(i + 1) % n]
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) out.push({ message: `Corners ${i + 1} and ${((i + 1) % n) + 1} are in the same place.`, vertices: [i, (i + 1) % n] })
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      if (segmentsCross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) out.push({ message: `Wall ${i + 1} crosses wall ${j + 1}.`, vertices: [i, (i + 1) % n, j, (j + 1) % n] })
    }
  }
  if (!out.length && Math.abs(signedArea(p)) < 1) out.push({ message: 'The room has no floor area.', vertices: [] })
  return out
}

function lineIntersect(p: Vec, d: Vec, q: Vec, e: Vec): Vec | null {
  const den = cross(d, e)
  if (Math.abs(den) < 1e-9) return null
  const t = cross(sub(q, p), e) / den
  return add(p, mul(d, t))
}

/**
 * Wall bands for a clockwise outline: each band runs along the interior face of its edge and extends outward by
 * `t`, mitred where it meets its neighbours so adjoining walls meet cleanly at any angle.
 */
export function wallBands(p: Poly, t: number): Poly[] {
  const n = p.length
  const outer: Vec[] = []
  for (let i = 0; i < n; i++) {
    const prev = p[(i + n - 1) % n]
    const cur = p[i]
    const next = p[(i + 1) % n]
    const d0 = norm(sub(cur, prev))
    const d1 = norm(sub(next, cur))
    const o0 = mul(inwardNormal(prev, cur), -t)
    const o1 = mul(inwardNormal(cur, next), -t)
    const hit = lineIntersect(add(prev, o0), d0, add(cur, o1), d1)
    outer.push(hit ?? add(cur, o1))
  }
  return p.map((a, i) => [a, p[(i + 1) % n], outer[(i + 1) % n], outer[i]])
}

/** Translate so the bounding box's north-west corner is the origin. Returns the shift that was applied. */
export function originShift(p: Poly): Vec {
  const b = bbox(p)
  return { x: -b.minX, y: -b.minY }
}

/** True if the outline is an axis-aligned rectangle (4 corners). */
export function isAxisRect(p: Poly): boolean {
  if (p.length !== 4) return false
  const b = bbox(p)
  return p.every((v) => (Math.abs(v.x - b.minX) < 1e-6 || Math.abs(v.x - b.maxX) < 1e-6) && (Math.abs(v.y - b.minY) < 1e-6 || Math.abs(v.y - b.maxY) < 1e-6))
}
