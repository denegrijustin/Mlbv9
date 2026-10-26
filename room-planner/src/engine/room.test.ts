import { describe, expect, it } from 'vitest'
import { area, bbox } from '../geometry/polygon'
import { makeBuiltIn, makeDoor, makePillar, makeWallTV, makeWindow } from '../model/defaults'
import type { Room } from '../model/types'
import { OPEN_EXTENT, resolveArchitecture, swingSector } from './room'
import { baselineSeedRoom } from '../model/testSeed'

const room = (over: Partial<Room> = {}): Room => ({ ...baselineSeedRoom(), width: 101, depth: 120, items: [], ...over })

describe('seed office', () => {
  const seed = resolveArchitecture(baselineSeedRoom())
  it('has only the supplied 101" dimension; nothing else is invented', () => {
    expect(seed.room.width).toBe(101)
    expect(seed.room.depth).toBeNull()
    expect(seed.room.complete).toBe(false)
    for (const a of seed.arch) {
      expect(a.placed).toBe(false)
      expect(a.polygon).toBeNull()
      expect(a.segment).toBeNull()
    }
  })
  it('lists the room depth and every unmeasured item as unresolved', () => {
    const names = seed.unresolved.map((u) => u.name)
    expect(names).toContain('Room dimensions')
    expect(names).toContain('Window')
    expect(names).toContain('Doorway')
    expect(names).toContain('Wood pillar / column')
    expect(names).toContain('Built-in bookcases')
    expect(names).toContain('Wall-mounted TV')
    expect(seed.unresolved.find((u) => u.type === 'room')?.missing).toEqual(['Depth (north–south)'])
  })
  it('flags the missing side as open rather than assuming a size', () => {
    expect(seed.room.openSides).toEqual(['south'])
    expect(seed.room.walls.map((w) => w.id).sort()).toEqual(['east', 'north', 'west'])
    expect(seed.room.walls.find((w) => w.id === 'west')?.length).toBeNull()
    expect(seed.room.walls.find((w) => w.id === 'north')?.length).toBe(101)
    expect(bbox(seed.room.polygon).maxY).toBe(OPEN_EXTENT)
  })
  it('has no conflicts to report yet', () => {
    expect(seed.issues).toEqual([])
  })
})

describe('perimeter walls and attached items', () => {
  it('places a window along the north wall from the west corner', () => {
    const r = room({ items: [makeWindow({ wallId: 'north', offset: 20, width: 36 })] })
    const w = resolveArchitecture(r).arch[0]
    expect(w.placed).toBe(true)
    expect(w.segment).toEqual({ a: { x: 20, y: 0 }, b: { x: 56, y: 0 } })
  })
  it('measures east and west wall offsets from the north end', () => {
    const r = room({ items: [makeWindow({ wallId: 'east', offset: 10, width: 30 }), makeWindow({ wallId: 'west', offset: 10, width: 30 })] })
    const [e, w] = resolveArchitecture(r).arch
    expect(e.segment).toEqual({ a: { x: 101, y: 10 }, b: { x: 101, y: 40 } })
    expect(w.segment).toEqual({ a: { x: 0, y: 10 }, b: { x: 0, y: 40 } })
  })
  it('measures south wall offsets from the west end', () => {
    const s = resolveArchitecture(room({ items: [makeDoor({ wallId: 'south', offset: 5, width: 30, style: 'opening' })] })).arch[0]
    expect(s.segment).toEqual({ a: { x: 5, y: 120 }, b: { x: 35, y: 120 } })
  })
  it('an item on a wall that cannot exist yet stays unplaced and says why', () => {
    const r = room({ depth: null, items: [makeDoor({ wallId: 'south', offset: 5, width: 30 })] })
    const a = resolveArchitecture(r).arch[0]
    expect(a.placed).toBe(false)
    expect(a.missing.join(' ')).toMatch(/Room depth/)
  })
  it('wall TV gets a footprint only when its projection is known', () => {
    const base = { wallId: 'north', offset: 10, width: 40 }
    expect(resolveArchitecture(room({ items: [makeWallTV(base)] })).arch[0].polygon).toBeNull()
    const withDepth = resolveArchitecture(room({ items: [makeWallTV({ ...base, thickness: 3 })] })).arch[0]
    expect(area(withDepth.polygon!)).toBeCloseTo(120, 9)
  })
})

describe('door swing', () => {
  it('sweeps a quarter circle into the room for an inward door', () => {
    const d = resolveArchitecture(room({ items: [makeDoor({ wallId: 'north', offset: 30, width: 32, hinge: 'start', swing: 'in' })] })).arch[0]
    expect(d.swingZone).not.toBeNull()
    const exact = (Math.PI * 32 * 32) / 4
    expect(Math.abs(area(d.swingZone!) - exact) / exact).toBeLessThan(0.005) // polygonal arc, within 0.5%
    const b = bbox(d.swingZone!)
    expect(b.minY).toBeCloseTo(0, 6)
    expect(b.maxY).toBeCloseTo(32, 6)
    expect(d.leaf?.hinge).toEqual({ x: 30, y: 0 })
    expect(d.leaf?.tip.y).toBeCloseTo(32, 9)
  })
  it('swings outward when asked and hinges at the far end', () => {
    const d = resolveArchitecture(room({ items: [makeDoor({ wallId: 'north', offset: 30, width: 32, hinge: 'end', swing: 'out' })] })).arch[0]
    const b = bbox(d.swingZone!)
    expect(b.maxY).toBeCloseTo(0, 6)
    expect(b.minY).toBeCloseTo(-32, 6)
    expect(d.leaf?.hinge).toEqual({ x: 62, y: 0 })
  })
  it('a plain opening has no swing', () => {
    const d = resolveArchitecture(room({ items: [makeDoor({ wallId: 'north', offset: 30, width: 32, style: 'opening' })] })).arch[0]
    expect(d.swingZone).toBeNull()
  })
  it('swingSector is a pie slice from the hinge', () => {
    const s = swingSector({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, 10)
    expect(s[0]).toEqual({ x: 0, y: 0 })
    expect(s[1].x).toBeCloseTo(10, 9)
    expect(s[s.length - 1].y).toBeCloseTo(10, 9)
  })
})

describe('conflicting measurements are reported, never silently fixed', () => {
  it('window that does not fit the wall names every measurement involved', () => {
    const r = room({ items: [makeWindow({ name: 'Big window', wallId: 'north', offset: 60, width: 48 })] })
    const { issues } = resolveArchitecture(r)
    const fit = issues.find((i) => i.id.startsWith('fit-'))!
    expect(fit.severity).toBe('error')
    expect(fit.message).toContain('108"')
    expect(fit.message).toContain('101"')
    expect(fit.measurements).toEqual(['Big window position', 'Big window width', 'North wall length'])
    // and the stored numbers are untouched
    expect(r.items[0]).toMatchObject({ offset: 60, width: 48 })
  })
  it('pillar outside the room is an error that cites the room dimensions', () => {
    const { issues } = resolveArchitecture(room({ items: [makePillar({ x: 90, y: 10, width: 20, depth: 20 })] }))
    const out = issues.find((i) => i.id.startsWith('out-'))!
    expect(out.severity).toBe('error')
    expect(out.measurements).toContain('Room width')
  })
  it('overlapping solids and overlapping wall openings are flagged', () => {
    const r = room({
      items: [
        makePillar({ name: 'Pillar', x: 10, y: 10, width: 20, depth: 20 }),
        makeBuiltIn({ name: 'Bookcase', x: 25, y: 10, width: 30, depth: 12 }),
        makeWindow({ name: 'Window', wallId: 'north', offset: 0, width: 40 }),
        makeWallTV({ name: 'TV', wallId: 'north', offset: 30, width: 40 }),
      ],
    })
    const ids = resolveArchitecture(r).issues.map((i) => i.id)
    expect(ids.some((i) => i.startsWith('solid-'))).toBe(true)
    expect(ids.some((i) => i.startsWith('ovl-'))).toBe(true)
  })
  it('door swing into a pillar is flagged', () => {
    const r = room({ items: [makeDoor({ wallId: 'north', offset: 30, width: 32 }), makePillar({ x: 40, y: 5, width: 10, depth: 10 })] })
    expect(resolveArchitecture(r).issues.some((i) => i.id.startsWith('swing-'))).toBe(true)
  })
  it('touching but not overlapping solids is fine', () => {
    const r = room({ items: [makePillar({ x: 10, y: 10, width: 10, depth: 10 }), makeBuiltIn({ x: 20, y: 10, width: 10, depth: 10 })] })
    expect(resolveArchitecture(r).issues).toEqual([])
  })
  it('interior wall endpoints outside the room are reported', () => {
    const r = room({ interiorWalls: [{ id: 'iw', name: 'Partition', a: { x: 10, y: 10 }, b: { x: 140, y: 10 }, thickness: 4.5, locked: false }] })
    expect(resolveArchitecture(r).issues.some((i) => i.id.startsWith('wall-out-'))).toBe(true)
  })
})
