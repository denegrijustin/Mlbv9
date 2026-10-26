import polygonClipping, { type MultiPolygon, type Pair, type Polygon as PCPolygon } from 'polygon-clipping'
import type { Poly } from './polygon'
import type { Vec } from './vec'

const closeRing = (p: Poly): Pair[] => {
  const ring: Pair[] = p.map((v) => [v.x, v.y])
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]])
  return ring
}

const toGeom = (p: Poly): PCPolygon => [closeRing(p)]

const ringArea = (r: Pair[]): number => {
  let a = 0
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
  return Math.abs(a) / 2
}

/** Area of a multipolygon (outer rings minus holes). */
export function multiArea(mp: MultiPolygon): number {
  let total = 0
  for (const poly of mp) {
    poly.forEach((ring, i) => {
      total += i === 0 ? ringArea(ring) : -ringArea(ring)
    })
  }
  return total
}

export interface ClipResult {
  area: number
  /** Outer rings of each resulting piece, as plain polygons (holes are dropped; fine for highlighting). */
  outlines: Poly[]
}

const toResult = (mp: MultiPolygon): ClipResult => ({
  area: multiArea(mp),
  outlines: mp.map((poly) => poly[0].slice(0, -1).map(([x, y]): Vec => ({ x, y }))),
})

/** The part of A that overlaps B. */
export function intersect(a: Poly, b: Poly): ClipResult {
  try {
    return toResult(polygonClipping.intersection(toGeom(a), toGeom(b)))
  } catch {
    return { area: 0, outlines: [] }
  }
}

/** The part of A that lies outside B. */
export function subtract(a: Poly, b: Poly): ClipResult {
  try {
    return toResult(polygonClipping.difference(toGeom(a), toGeom(b)))
  } catch {
    return { area: 0, outlines: [] }
  }
}
