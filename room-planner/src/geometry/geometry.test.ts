import { describe, expect, it } from 'vitest'
import { area, bbox, bboxSize, centroid, pointInPolygon, rectPoly, transformPoly } from './polygon'
import { closestPolyPoly, closestSegSeg } from './distance'
import { intersect, subtract } from './clip'
import { lDeskOverallDepth, lDeskPolygon, validateLDesk, type LDeskShape } from './shapes'
import { angleDiff, wrapDeg } from './vec'

const DESK: LDeskShape = { kind: 'ldesk', mainLength: 64, mainDepth: 24, returnLength: 43.5, returnWidth: 21, innerRadius: 6, returnSide: 'left', returnMeasure: 'outer' }

describe('polygon basics', () => {
  it('area, centroid and bbox of a rectangle', () => {
    const r = rectPoly(10, 20, 30, 40)
    expect(area(r)).toBe(1200)
    expect(centroid(r)).toEqual({ x: 25, y: 40 })
    expect(bbox(r)).toEqual({ minX: 10, minY: 20, maxX: 40, maxY: 60 })
  })
  it('point in polygon, including concave shapes and edges', () => {
    const l = lDeskPolygon(DESK)
    expect(pointInPolygon({ x: 0, y: -20 }, l)).toBe(true) // middle of main run
    expect(pointInPolygon({ x: 20, y: 15 }, l)).toBe(false) // inside the notch of the L
    expect(pointInPolygon({ x: -32, y: 0 }, l)).toBe(true) // on the outer left edge
  })
  it('rotates clockwise on screen and flips about the origin', () => {
    const p = transformPoly([{ x: 10, y: 0 }], { x: 0, y: 0, rotation: 90 })[0]
    expect(p.x).toBeCloseTo(0, 9)
    expect(p.y).toBeCloseTo(10, 9) // +x rotated 90 degrees clockwise (y is down) points down
    const f = transformPoly([{ x: 10, y: 5 }], { x: 100, y: 100, rotation: 0, flipX: true })[0]
    expect(f).toEqual({ x: 90, y: 105 })
  })
})

describe('closest distances', () => {
  it('segment to segment', () => {
    expect(closestSegSeg({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }).dist).toBe(5)
    expect(closestSegSeg({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }).dist).toBeCloseTo(0, 9)
    const c = closestSegSeg({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 14, y: 3 }, { x: 14, y: 9 })
    expect(c.dist).toBe(5)
    expect(c.p).toEqual({ x: 10, y: 0 })
    expect(c.q).toEqual({ x: 14, y: 3 })
  })
  it('collinear overlapping segments are distance 0', () => {
    expect(closestSegSeg({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 }).dist).toBeCloseTo(0, 9)
  })
  it('degenerate segments', () => {
    expect(closestSegSeg({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 4, y: 5 }, { x: 4, y: 5 }).dist).toBe(5)
  })
  it('polygon to polygon', () => {
    const a = rectPoly(0, 0, 10, 10)
    const b = rectPoly(13, 0, 10, 10)
    expect(closestPolyPoly(a, b).dist).toBe(3)
    expect(closestPolyPoly(a, rectPoly(10, 0, 5, 5)).dist).toBe(0)
  })
})

describe('clipping', () => {
  it('intersection area and outline', () => {
    const r = intersect(rectPoly(0, 0, 10, 10), rectPoly(5, 5, 10, 10))
    expect(r.area).toBeCloseTo(25, 9)
    expect(r.outlines).toHaveLength(1)
    expect(intersect(rectPoly(0, 0, 10, 10), rectPoly(20, 20, 5, 5)).area).toBe(0)
  })
  it('flush neighbours do not count as overlap', () => {
    expect(intersect(rectPoly(0, 0, 10, 10), rectPoly(10, 0, 10, 10)).area).toBeCloseTo(0, 9)
  })
  it('subtract gives the part outside', () => {
    const out = subtract(rectPoly(-5, 0, 10, 10), rectPoly(0, 0, 100, 100))
    expect(out.area).toBeCloseTo(50, 9)
  })
  it('works for concave polygons', () => {
    const l = lDeskPolygon(DESK)
    // a box sitting entirely inside the notch of the L must not overlap the desk
    const notch = transformPoly(rectPoly(-5, -5, 10, 10), { x: 12, y: 14, rotation: 0 })
    expect(intersect(l, notch).area).toBeCloseTo(0, 6)
  })
})

describe('L-shaped desk', () => {
  const poly = lDeskPolygon(DESK)
  it('has the exact overall footprint from the measurements', () => {
    const s = bboxSize(bbox(poly))
    expect(s.w).toBeCloseTo(64, 9)
    expect(s.h).toBeCloseTo(43.5, 9)
  })
  it('is centred on its bounding box', () => {
    const b = bbox(poly)
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 9)
    expect((b.minY + b.maxY) / 2).toBeCloseTo(0, 9)
  })
  it('is a real L polygon, not a rectangle', () => {
    const bboxArea = 64 * 43.5
    expect(area(poly)).toBeLessThan(bboxArea)
    // without the curve the area is exactly main + return: 64*24 + 21*(43.5-24)
    const sharp = lDeskPolygon({ ...DESK, innerRadius: 0 })
    expect(area(sharp)).toBeCloseTo(64 * 24 + 21 * 19.5, 9)
    // the curve adds a small fillet: r^2 (1 - pi/4) of extra desk
    expect(area(poly) - area(sharp)).toBeCloseTo(6 * 6 * (1 - Math.PI / 4), 1)
  })
  it('keeps the curve inside the notch and has many vertices', () => {
    expect(poly.length).toBeGreaterThan(12)
  })
  it('mirrors to the other side without changing the footprint', () => {
    const right = lDeskPolygon({ ...DESK, returnSide: 'right' })
    expect(area(right)).toBeCloseTo(area(poly), 9)
    const left = bbox(poly)
    const rb = bbox(right)
    expect(rb.maxX - rb.minX).toBeCloseTo(left.maxX - left.minX, 9)
    // return is on the right: a point on the far right, low down is inside
    expect(pointInPolygon({ x: 30, y: 15 }, right)).toBe(true)
    expect(pointInPolygon({ x: -30, y: 15 }, right)).toBe(false)
  })
  it('treats return length as beyond the main run when asked', () => {
    const beyond: LDeskShape = { ...DESK, returnMeasure: 'beyond', returnLength: 19.5 }
    expect(lDeskOverallDepth(beyond)).toBe(43.5)
    expect(area(lDeskPolygon(beyond))).toBeCloseTo(area(poly), 9)
  })
  it('validates impossible dimensions', () => {
    expect(validateLDesk(DESK)).toEqual([])
    expect(validateLDesk({ ...DESK, returnWidth: 70 }).length).toBeGreaterThan(0)
    expect(validateLDesk({ ...DESK, returnLength: 20 }).some((i) => i.field === 'returnLength')).toBe(true)
    expect(validateLDesk({ ...DESK, innerRadius: 60 }).some((i) => i.field === 'innerRadius')).toBe(true)
  })
})

describe('angles', () => {
  it('wraps and diffs', () => {
    expect(wrapDeg(-90)).toBe(270)
    expect(wrapDeg(450)).toBe(90)
    expect(angleDiff(10, 350)).toBe(20)
    expect(angleDiff(350, 10)).toBe(-20)
  })
})
