import { describe, expect, it } from 'vitest'
import { bbox, rectPoly } from '../geometry/polygon'
import type { Room } from '../model/types'
import { resolveRoom } from './room'
import { snapAngle, snapMove, type SnapOptions, type SnapTarget } from './snapping'
import { baselineSeedRoom } from '../model/testSeed'

const room = (over: Partial<Room> = {}) => resolveRoom({ ...baselineSeedRoom(), width: 101, depth: 120, items: [], ...over })
const opts: SnapOptions = { enabled: true, walls: true, edges: true, centers: true, grid: 0, threshold: 3 }
const boxAt = (x: number, y: number, w: number, h: number) => bbox(rectPoly(x, y, w, h))

describe('wall snapping', () => {
  it('pulls a desk flush to the north wall inside the threshold', () => {
    const r = snapMove(boxAt(20, 2.5, 60, 30), room(), [], opts)
    expect(r.dy).toBeCloseTo(-2.5, 9)
    expect(r.snappedY).toBe('wall')
  })
  it('does not snap beyond the threshold', () => {
    const r = snapMove(boxAt(20, 12, 60, 30), room(), [], { ...opts, centers: false })
    expect(r.dy).toBe(0)
    expect(r.snappedY).toBeNull()
  })
  it('snaps into a corner on both axes', () => {
    const r = snapMove(boxAt(1.5, 2, 60, 30), room(), [], opts)
    expect(r.dx).toBeCloseTo(-1.5, 9)
    expect(r.dy).toBeCloseTo(-2, 9)
  })
  it('snaps to the far (east and south) walls using the object\'s far edge', () => {
    const r = snapMove(boxAt(101 - 60 - 2, 120 - 30 - 3, 60, 30), room(), [], opts)
    expect(r.dx).toBeCloseTo(2, 9)
    expect(r.dy).toBeCloseTo(3, 9)
  })
  it('does not snap to a wall that is not there yet (unmeasured depth)', () => {
    const open = room({ depth: null })
    const r = snapMove(boxAt(20, 1200 - 30 - 2, 60, 30), open, [], { ...opts, centers: false })
    expect(r.dy).toBe(0)
  })
  it('can be switched off entirely (the Alt-key override)', () => {
    const r = snapMove(boxAt(20, 2.5, 60, 30), room(), [], { ...opts, enabled: false })
    expect(r).toMatchObject({ dx: 0, dy: 0, guides: [] })
  })
  it('walls can be disabled independently', () => {
    const r = snapMove(boxAt(20, 2.5, 60, 30), room(), [], { ...opts, walls: false, centers: false })
    expect(r.dy).toBe(0)
  })
})

describe('furniture snapping', () => {
  const other: SnapTarget = { id: 'o', box: boxAt(40, 50, 30, 20) }
  it('butts against the edge of a neighbour', () => {
    const r = snapMove(boxAt(5, 52, 33, 15), room(), [other], { ...opts, walls: false })
    expect(r.dx).toBeCloseTo(2, 9) // right edge 38 -> 40
    expect(r.snappedX).toBe('butt')
    expect(r.guides.some((g) => g.axis === 'x' && g.value === 40)).toBe(true)
  })
  it('aligns edges and reports a guide', () => {
    const r = snapMove(boxAt(41.5, 80, 10, 10), room(), [other], { ...opts, walls: false, centers: false })
    expect(r.dx).toBeCloseTo(-1.5, 9)
    expect(r.snappedX).toBe('align')
  })
  it('aligns centres', () => {
    // other centre x = 55. Candidate centre x = 56.5, width 11 so edges are far from 40/70.
    const r = snapMove(boxAt(51, 100, 11, 8), room(), [other], { ...opts, walls: false })
    expect(r.snappedX).toBe('center')
    expect(r.dx).toBeCloseTo(-1.5, 9)
    expect(r.guides.find((g) => g.kind === 'center')?.value).toBe(55)
  })
  it('prefers the smallest correction: an already-aligned neighbour beats a wall 1 inch away', () => {
    const r = snapMove(boxAt(1, 20, 10, 10), room(), [{ id: 'n', box: boxAt(1, 40, 10, 10) }], opts)
    expect(r.dx).toBe(0)
    expect(r.snappedX).toBe('align')
  })
  it('walls win exact ties', () => {
    // wall flush = -1, aligning left edges with a neighbour at x=0 is also -1
    const r = snapMove(boxAt(1, 20, 10, 10), room(), [{ id: 'n', box: boxAt(0, 40, 10, 10) }], opts)
    expect(r.dx).toBeCloseTo(-1, 9)
    expect(r.snappedX).toBe('wall')
  })
  it('does not butt against something far away on the other axis', () => {
    const far: SnapTarget = { id: 'f', box: boxAt(40, 200, 30, 20) }
    const r = snapMove(boxAt(5, 52, 33, 15), room(), [far], { ...opts, walls: false, centers: false })
    expect(r.snappedX).toBeNull()
  })
})

describe('grid snapping', () => {
  it('snaps the bounding box corner to the grid when nothing else applies', () => {
    const r = snapMove(boxAt(25.4, 38.9, 10, 10), room(), [], { ...opts, grid: 6, walls: false, edges: false, centers: false })
    expect(r.dx).toBeCloseTo(-1.4, 9)
    expect(r.dy).toBeCloseTo(-2.9, 9) // 38.9 -> 36
    expect(r.snappedX).toBe('grid')
  })
  it('object snapping beats grid snapping', () => {
    const r = snapMove(boxAt(1, 20, 10, 10), room(), [], { ...opts, grid: 6 })
    expect(r.snappedX).toBe('wall')
    expect(r.dx).toBeCloseTo(-1, 9)
  })
})

describe('snapAngle', () => {
  it('snaps to 15, 45 and 90 degree steps', () => {
    expect(snapAngle(37, 15)).toBe(30)
    expect(snapAngle(38, 15)).toBe(45)
    expect(snapAngle(100, 45)).toBe(90)
    expect(snapAngle(46, 90)).toBe(90)
    expect(snapAngle(-10, 15)).toBe(345)
    expect(snapAngle(359, 90)).toBe(0)
  })
  it('free rotation keeps the angle but gently locks onto right angles', () => {
    expect(snapAngle(37.34, 0)).toBe(37.3)
    expect(snapAngle(91.5, 0)).toBe(90)
    expect(snapAngle(88.5, 0)).toBe(90)
    expect(snapAngle(93, 0)).toBe(93)
    expect(snapAngle(359.2, 0)).toBe(0)
    expect(snapAngle(91.5, 0, false)).toBe(91.5)
  })
})
