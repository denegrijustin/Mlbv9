import { describe, expect, it } from 'vitest'
import { createSeedRoom, furnitureFromTemplate, makeBuiltIn, makeDoor, makePillar, makeWindow } from '../model/defaults'
import { DEFAULT_SETTINGS } from '../model/defaults'
import { SEED_DESK_TEMPLATE, STARTER_LIBRARY } from '../model/library'
import type { FurnitureItem, Room } from '../model/types'
import { computeChairZone, computeClearances, workEdges } from './clearance'
import { constrainMove, findCollisions } from './collisions'
import { resolveArchitecture } from './room'
import { buildObstacles, furniturePolygon } from './scene'

const room = (over: Partial<Room> = {}): Room => ({ ...createSeedRoom(), width: 101, depth: 120, items: [], ...over })
const tpl = (id: string) => STARTER_LIBRARY.find((t) => t.id === id)!
const rules = DEFAULT_SETTINGS.rules
const place = (id: string, x: number, y: number, rotation = 0): FurnitureItem => ({ ...furnitureFromTemplate(tpl(id), { x, y }), rotation })

function analyse(r: Room, furniture: FurnitureItem[], selfId: string) {
  const arch = resolveArchitecture(r)
  const self = furniture.find((f) => f.id === selfId)!
  const poly = furniturePolygon(self)
  const obstacles = buildObstacles(arch, furniture, { rules }, { exceptId: selfId })
  const collisions = findCollisions(poly, obstacles, arch.room.polygon)
  const clearances = computeClearances(selfId, poly, { arch, furniture, rules }, collisions)
  return { arch, self, poly, obstacles, collisions, clearances }
}

describe('collisions', () => {
  it('a desk well inside an empty room has no collisions', () => {
    const d = place('tpl-desk', 50, 60)
    expect(analyse(room(), [d], d.id).collisions).toEqual([])
  })
  it('flush against a wall is not a collision', () => {
    const d = place('tpl-desk', 30, 15) // 60x30 desk: left edge x=0, top edge y=0
    const a = analyse(room(), [d], d.id)
    expect(a.collisions).toEqual([])
    const north = a.clearances.find((c) => c.id === 'north')!
    expect(north.distance).toBeCloseTo(0, 9)
    expect(north.status).toBe('flush')
  })
  it('sticking through a wall collides and reports the outside area', () => {
    const d = place('tpl-desk', 30, 10) // top edge at y=-5
    const c = analyse(room(), [d], d.id).collisions
    expect(c).toHaveLength(1)
    expect(c[0].kind).toBe('wall')
    expect(c[0].area).toBeCloseTo(60 * 5, 6)
  })
  it('furniture overlapping furniture is reported with its outline', () => {
    const a = place('tpl-desk', 50, 60)
    const b = place('tpl-table', 60, 70)
    const c = analyse(room(), [a, b], a.id).collisions
    expect(c.map((x) => x.obstacleId)).toEqual([b.id])
    expect(c[0].outlines[0].length).toBeGreaterThanOrEqual(4)
  })
  it('collides with pillars and built-ins', () => {
    const r = room({ items: [makePillar({ x: 40, y: 50, width: 20, depth: 20 }), makeBuiltIn({ x: 0, y: 100, width: 40, depth: 20 })] })
    const d = place('tpl-desk', 50, 60)
    expect(analyse(r, [d], d.id).collisions.map((c) => c.kind)).toContain('pillar')
    const e = place('tpl-desk', 20, 105)
    expect(analyse(r, [e], e.id).collisions.map((c) => c.kind)).toContain('builtin')
  })
  it('blocking the door swing is a collision when the rule is on, and ignored when off', () => {
    const r = room({ items: [makeDoor({ wallId: 'north', offset: 30, width: 32, hinge: 'start', swing: 'in' })] })
    const d = place('tpl-desk', 46, 20)
    expect(analyse(r, [d], d.id).collisions.map((c) => c.kind)).toContain('door-swing')
    const arch = resolveArchitecture(r)
    const off = buildObstacles(arch, [d], { rules: { ...rules, keepDoorSwingClear: false } }, { exceptId: d.id })
    expect(findCollisions(furniturePolygon(d), off, arch.room.polygon)).toEqual([])
  })
  it('rugs and hidden items never collide', () => {
    const a = place('tpl-desk', 50, 60)
    const rug = place('tpl-rug', 50, 60)
    const hidden = { ...place('tpl-table', 50, 60), hidden: true }
    expect(analyse(room(), [a, rug, hidden], a.id).collisions).toEqual([])
  })
  it('the concave notch of the L-desk does not collide with something sitting inside it', () => {
    const desk = { ...furnitureFromTemplate(SEED_DESK_TEMPLATE, { x: 60, y: 40 }) }
    const chair = place('tpl-chair', 0, 0)
    // notch of the unrotated left-return L: right of the return (x from desk.x-32+21=49), below the main run (y from 40-21.75+24=42.25)
    chair.x = 49 + 13 + 8
    chair.y = 42.25 + 13 + 6
    const a = analyse(room(), [desk, chair], desk.id)
    expect(a.collisions).toEqual([])
  })
  it('a rotated L-desk polygon stays dimensionally accurate', () => {
    const desk = { ...furnitureFromTemplate(SEED_DESK_TEMPLATE, { x: 60, y: 60 }), rotation: 90 }
    const xs = furniturePolygon(desk).map((p) => p.x)
    const ys = furniturePolygon(desk).map((p) => p.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(43.5, 9)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(64, 9)
  })
})

describe('constrainMove (prevent-overlap mode)', () => {
  const wall = (p: { x: number; y: number }) => p.x > 50 // everything beyond x=50 is blocked
  it('allows free movement', () => {
    expect(constrainMove({ x: 10, y: 20 }, { x: 0, y: 0 }, wall)).toEqual({ x: 10, y: 20 })
  })
  it('slides along the blocked axis', () => {
    expect(constrainMove({ x: 60, y: 30 }, { x: 40, y: 10 }, wall)).toEqual({ x: 40, y: 30 })
  })
  it('stops at contact when both slides are blocked', () => {
    const box = (p: { x: number; y: number }) => p.x > 50 || p.y > 50
    const r = constrainMove({ x: 80, y: 80 }, { x: 40, y: 40 }, box)
    expect(r.x).toBeLessThanOrEqual(50.1)
    expect(r.y).toBeLessThanOrEqual(50.1)
  })
})

describe('clearances', () => {
  it('measures exact distances to every wall', () => {
    const d = place('tpl-desk', 50, 60) // spans x 20..80, y 45..75
    const c = analyse(room(), [d], d.id).clearances
    const by = Object.fromEntries(c.map((x) => [x.id, x.distance]))
    expect(by.north).toBeCloseTo(45, 9)
    expect(by.west).toBeCloseTo(20, 9)
    expect(by.east).toBeCloseTo(21, 9)
    expect(by.south).toBeCloseTo(45, 9)
  })
  it('classifies gaps: flush, tight, good, collision', () => {
    const r = room()
    const tight = place('tpl-desk', 50, 60)
    tight.y = 15 + 20 // 20" from north wall
    const t = analyse(r, [tight], tight.id).clearances.find((x) => x.id === 'north')!
    expect(t.status).toBe('tight')
    expect(t.note).toMatch(/minimum walking path/)
    const mid = { ...tight, y: 15 + 33 }
    const m = analyse(r, [mid], mid.id).clearances.find((x) => x.id === 'north')!
    expect(m.status).toBe('tight')
    expect(m.note).toMatch(/comfortable/)
    const good = { ...tight, y: 15 + 40 }
    expect(analyse(r, [good], good.id).clearances.find((x) => x.id === 'north')!.status).toBe('good')
  })
  it('lists nearby furniture, windows and the door swing with distances', () => {
    const r = room({ items: [makeWindow({ wallId: 'north', offset: 10, width: 40 }), makeDoor({ wallId: 'west', offset: 20, width: 30, hinge: 'start', swing: 'in' })] })
    const desk = place('tpl-desk', 60, 40)
    const bookshelf = place('tpl-bookshelf', 60, 90)
    const c = analyse(r, [desk, bookshelf], desk.id).clearances
    expect(c.find((x) => x.id === bookshelf.id)!.distance).toBeCloseTo(90 - 6 - 55, 9)
    expect(c.find((x) => x.kind === 'window')).toBeDefined()
    expect(c.find((x) => x.kind === 'door-swing')).toBeDefined()
  })
  it('dimension line end points sit on the two surfaces', () => {
    const d = place('tpl-desk', 50, 60)
    const north = analyse(room(), [d], d.id).clearances.find((x) => x.id === 'north')!
    expect(north.from.y).toBeCloseTo(45, 9)
    expect(north.to.y).toBeCloseTo(0, 9)
  })
})

describe('chair clearance zone', () => {
  it('rect desk: front is +y of the object', () => {
    const e = workEdges(place('tpl-desk', 50, 60))[0]
    expect(e.a.y).toBeCloseTo(75, 9)
    expect(e.n).toEqual({ x: 0, y: 1 })
  })
  it('rotating the desk rotates its chair side', () => {
    const e = workEdges(place('tpl-desk', 50, 60, 90))[0]
    expect(e.n.x).toBeCloseTo(-1, 9)
    expect(e.n.y).toBeCloseTo(0, 9)
  })
  it('reports the real free depth against the wall behind the chair', () => {
    const r = room() // depth 120
    const desk = place('tpl-desk', 50, 60)
    desk.y = 120 - 20 - 15 // front edge 20" from the south wall
    const arch = resolveArchitecture(r)
    const obstacles = buildObstacles(arch, [desk], { rules }, { exceptId: desk.id, includeChairs: false })
    const z = computeChairZone(desk, obstacles, arch.room.polygon, rules)!
    expect(z.free).toBeCloseTo(20, 1)
    expect(z.status).toBe('collision') // below the 30" walking minimum
    desk.y = 120 - 33 - 15
    const z2 = computeChairZone(desk, buildObstacles(arch, [desk], { rules }, { exceptId: desk.id }), arch.room.polygon, rules)!
    expect(z2.free).toBeCloseTo(33, 1)
    expect(z2.status).toBe('tight')
    desk.y = 120 - 40 - 15
    const z3 = computeChairZone(desk, buildObstacles(arch, [desk], { rules }, { exceptId: desk.id }), arch.room.polygon, rules)!
    expect(z3.free).toBeCloseTo(36, 6)
    expect(z3.status).toBe('good')
  })
  it('a chair in the zone does not block it, but a cabinet does', () => {
    const r = room()
    const desk = place('tpl-desk', 50, 40)
    const chair = place('tpl-chair', 50, 70)
    const arch = resolveArchitecture(r)
    const ignoreChairs = buildObstacles(arch, [desk, chair], { rules }, { exceptId: desk.id, includeChairs: false })
    expect(computeChairZone(desk, ignoreChairs, arch.room.polygon, rules)!.status).toBe('good')
    const cab = place('tpl-cabinet', 50, 85)
    const blocked = buildObstacles(arch, [desk, chair, cab], { rules }, { exceptId: desk.id, includeChairs: false })
    const z = computeChairZone(desk, blocked, arch.room.polygon, rules)!
    expect(z.free).toBeCloseTo(85 - 9 - 55, 1)
  })
  it('L-desk has two working sides inside the L', () => {
    const desk = furnitureFromTemplate(SEED_DESK_TEMPLATE, { x: 60, y: 40 })
    const edges = workEdges(desk)
    expect(edges).toHaveLength(2)
    expect(edges[0].n).toEqual({ x: 0, y: 1 })
    expect(edges[1].n).toEqual({ x: 1, y: 0 })
  })
  it('mirroring the L-desk mirrors its working sides', () => {
    const desk = { ...furnitureFromTemplate(SEED_DESK_TEMPLATE, { x: 60, y: 40 }), flipX: true }
    const edges = workEdges(desk)
    expect(edges[1].n.x).toBeCloseTo(-1, 9)
  })
  it('desks without a work side have no zone', () => {
    const shelf = place('tpl-bookshelf', 50, 50)
    expect(computeChairZone(shelf, [], resolveArchitecture(room()).room.polygon, rules)).toBeNull()
  })
})
