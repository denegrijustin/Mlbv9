import { describe, expect, it } from 'vitest'
import { createSeedRoom, DEFAULT_SETTINGS, furnitureFromTemplate, makeDoor } from '../model/defaults'
import { SEED_DESK_TEMPLATE, STARTER_LIBRARY } from '../model/library'
import type { FurnitureItem, Room } from '../model/types'
import { analyseFurniture, collisionMap } from './analysis'
import { resolveArchitecture } from './room'

const room = (over: Partial<Room> = {}): Room => ({ ...createSeedRoom(), width: 101, depth: 120, items: [], ...over })
const tpl = (id: string) => STARTER_LIBRARY.find((t) => t.id === id)!
const at = (id: string, x: number, y: number): FurnitureItem => furnitureFromTemplate(tpl(id), { x, y })

describe('analyseFurniture', () => {
  it('answers "does it fit?" and reports the chair space for the seed desk', () => {
    const arch = resolveArchitecture(room())
    const desk = furnitureFromTemplate(SEED_DESK_TEMPLATE, { x: 40, y: 28 })
    const a = analyseFurniture(desk, { arch, furniture: [desk], settings: DEFAULT_SETTINGS })
    expect(a.fits).toBe(true)
    expect(a.chairZone?.zones).toHaveLength(2)
    expect(a.nearestWall).not.toBeNull()
    expect(a.status).toBe('good')
  })
  it('works against the unfinished seed room (open depth) without inventing a wall', () => {
    const arch = resolveArchitecture(createSeedRoom())
    const desk = furnitureFromTemplate(SEED_DESK_TEMPLATE, { x: 40, y: 28 })
    const a = analyseFurniture(desk, { arch, furniture: [desk], settings: DEFAULT_SETTINGS })
    expect(a.fits).toBe(true)
    const walls = a.clearances.filter((c) => c.kind === 'wall').map((c) => c.id).sort()
    expect(walls).toEqual(['east', 'north', 'west']) // no south wall until the depth is measured
  })
  it('colliding furniture is a collision verdict; a tight chair space is tight', () => {
    const arch = resolveArchitecture(room())
    const desk = at('tpl-desk', 50, 40)
    const table = at('tpl-table', 60, 50)
    const bad = analyseFurniture(desk, { arch, furniture: [desk, table], settings: DEFAULT_SETTINGS })
    expect(bad.fits).toBe(false)
    expect(bad.status).toBe('collision')
    const wall = at('tpl-cabinet', 50, 40 + 15 + 33 + 9) // cabinet 33" in front of the desk
    const tight = analyseFurniture(desk, { arch, furniture: [desk, wall], settings: DEFAULT_SETTINGS })
    expect(tight.fits).toBe(true)
    expect(tight.chairZone?.status).toBe('tight')
    expect(tight.status).toBe('tight')
  })
  it('door swing intrusion makes the verdict a collision', () => {
    const arch = resolveArchitecture(room({ items: [makeDoor({ wallId: 'north', offset: 30, width: 32 })] }))
    const desk = at('tpl-desk', 46, 20)
    expect(analyseFurniture(desk, { arch, furniture: [desk], settings: DEFAULT_SETTINGS }).status).toBe('collision')
  })
})

describe('collisionMap', () => {
  it('lists only overlapping pieces', () => {
    const arch = resolveArchitecture(room())
    const a = at('tpl-desk', 50, 50)
    const b = at('tpl-table', 60, 60)
    const c = at('tpl-bookshelf', 20, 100)
    const m = collisionMap({ arch, furniture: [a, b, c], settings: DEFAULT_SETTINGS })
    expect([...m.keys()].sort()).toEqual([a.id, b.id].sort())
  })
})
