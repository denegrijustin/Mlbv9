import { beforeEach, describe, expect, it } from 'vitest'
import type { LDeskShape } from '../geometry/shapes'
import { STARTER_LIBRARY } from '../model/library'
import { exportProject, importProject, validateProject } from '../model/serialize'
import { selectActiveLayout, useProject } from './project'
import { baselineSeedProject } from '../model/testSeed'

const s = () => useProject.getState()
const desk = () => selectActiveLayout(s()).furniture[0]
const tpl = (id: string) => STARTER_LIBRARY.find((t) => t.id === id)!

beforeEach(() => {
  useProject.setState({ project: baselineSeedProject(), past: [], future: [], base: null, lastCommit: null, hydrated: true })
})

describe('seed project', () => {
  it('opens as "Office Layout" with the L-shaped desk placed and the 101" dimension', () => {
    expect(s().project.name).toBe('Office Layout')
    expect(s().project.room.width).toBe(101)
    expect(s().project.room.depth).toBeNull()
    expect(desk().shape.kind).toBe('ldesk')
    expect(desk().width).toBe(64)
    expect(desk().depth).toBe(43.5)
  })
})

describe('undo / redo', () => {
  it('undoes and redoes movement, rotation, dimensions, creation, deletion and architecture', () => {
    const id = desk().id
    s().updateFurniture(id, { x: 70, y: 50 })
    s().rotateFurniture(id, 90)
    const added = s().addFurniture(tpl('tpl-bookshelf'), { x: 20, y: 20 })
    s().updateRoom({ depth: 120 })
    s().addArch('pillar')
    s().removeFurniture([added])
    expect(selectActiveLayout(s()).furniture).toHaveLength(1)
    s().undo() // delete
    expect(selectActiveLayout(s()).furniture).toHaveLength(2)
    s().undo() // add pillar
    expect(s().project.room.items.filter((i) => i.type === 'pillar')).toHaveLength(1)
    s().undo() // hmm: seed already has a pillar, so one extra pillar was removed
    expect(s().project.room.items.filter((i) => i.type === 'pillar')).toHaveLength(1)
    s().undo() // room depth
    expect(s().project.room.depth).toBeNull()
    s().undo() // bookshelf
    expect(selectActiveLayout(s()).furniture).toHaveLength(1)
    s().undo() // rotation
    expect(desk().rotation).toBe(0)
    s().undo() // move
    expect(desk().x).toBe(40)
    expect(s().past).toHaveLength(0)
    s().redo()
    expect(desk().x).toBe(70)
    s().redo()
    expect(desk().rotation).toBe(90)
  })
  it('a new edit clears the redo stack', () => {
    const id = desk().id
    s().updateFurniture(id, { x: 70 })
    s().undo()
    expect(s().future).toHaveLength(1)
    s().updateFurniture(id, { x: 80 })
    expect(s().future).toHaveLength(0)
  })
  it('a whole drag gesture is one undo step', () => {
    const id = desk().id
    s().beginTransient()
    for (let x = 41; x <= 90; x++) s().updateFurniture(id, { x }, true)
    s().endTransient()
    expect(desk().x).toBe(90)
    expect(s().past).toHaveLength(1)
    s().undo()
    expect(desk().x).toBe(40)
  })
  it('cancelling a gesture restores the starting state with no history entry', () => {
    const id = desk().id
    s().beginTransient()
    s().updateFurniture(id, { x: 99 }, true)
    s().cancelTransient()
    expect(desk().x).toBe(40)
    expect(s().past).toHaveLength(0)
  })
  it('a gesture that changes nothing adds no history', () => {
    s().beginTransient()
    s().endTransient()
    expect(s().past).toHaveLength(0)
  })
  it('coalesces rapid keyboard nudges into one step', () => {
    const id = desk().id
    s().commit((d) => void (d.layouts[0].furniture.find((f) => f.id === id)!.x += 1), 'nudge')
    s().commit((d) => void (d.layouts[0].furniture.find((f) => f.id === id)!.x += 1), 'nudge')
    s().commit((d) => void (d.layouts[0].furniture.find((f) => f.id === id)!.x += 1), 'nudge')
    expect(desk().x).toBe(43)
    expect(s().past).toHaveLength(1)
  })
})

describe('furniture operations', () => {
  it('keeps a derived footprint size in sync when the L-desk is edited', () => {
    const id = desk().id
    s().updateFurniture(id, { shape: { ...(desk().shape as LDeskShape), returnLength: 50 } })
    expect(desk().depth).toBe(50)
    expect(desk().width).toBe(64)
  })
  it('mirror toggles flips without touching dimensions', () => {
    const id = desk().id
    s().mirrorFurniture(id, 'x')
    expect(desk().flipX).toBe(true)
    expect(desk().width).toBe(64)
    s().mirrorFurniture(id, 'x')
    expect(desk().flipX).toBe(false)
  })
  it('duplicates with a new id, offset position and unlocked', () => {
    const id = desk().id
    s().updateFurniture(id, { locked: true })
    const copy = s().duplicateFurniture(id)!
    const f = selectActiveLayout(s()).furniture.find((x) => x.id === copy)!
    expect(copy).not.toBe(id)
    expect(f.x).toBe(desk().x + 12)
    expect(f.locked).toBe(false)
    expect(f.depth).toBe(43.5)
  })
  it('rotation wraps into [0, 360)', () => {
    const id = desk().id
    s().rotateFurniture(id, -90)
    expect(desk().rotation).toBe(270)
    s().rotateFurniture(id, 180)
    expect(desk().rotation).toBe(90)
  })
})

describe('layouts', () => {
  it('shares architecture but separates furniture, and duplicates with fresh ids', () => {
    const a = s().project.activeLayoutId
    const aDeskId = desk().id
    const b = s().addLayout({ duplicate: true })
    expect(s().project.activeLayoutId).toBe(b)
    expect(desk().id).not.toBe(aDeskId)
    s().updateFurniture(desk().id, { x: 77 })
    s().setActiveLayout(a)
    expect(desk().x).toBe(40)
    s().updateRoom({ depth: 130 })
    s().setActiveLayout(b)
    expect(s().project.room.depth).toBe(130)
  })
  it('rename and delete, never deleting the last layout', () => {
    const a = s().project.activeLayoutId
    s().renameLayout(a, 'Option 1')
    expect(s().project.layouts[0].name).toBe('Option 1')
    s().deleteLayout(a)
    expect(s().project.layouts).toHaveLength(1)
    const b = s().addLayout()
    s().deleteLayout(b)
    expect(s().project.layouts).toHaveLength(1)
    expect(s().project.activeLayoutId).toBe(a)
  })
  it('switching layouts is not an undoable edit', () => {
    const a = s().project.activeLayoutId
    s().addLayout()
    const before = s().past.length
    s().setActiveLayout(a)
    expect(s().past.length).toBe(before)
  })
})

describe('architecture operations', () => {
  it('removing an interior wall unplaces items attached to it instead of moving them', () => {
    const wallId = s().addInteriorWall({ x: 10, y: 10 }, { x: 60, y: 10 })
    const win = s().addArch('window', { wallId, offset: 5, width: 20 })
    s().removeInteriorWall(wallId)
    const w = s().project.room.items.find((i) => i.id === win)!
    expect('wallId' in w && w.wallId).toBeNull()
  })
  it('swaps room width and depth', () => {
    s().swapRoomDimensions()
    expect(s().project.room.width).toBeNull()
    expect(s().project.room.depth).toBe(101)
  })
})

describe('import / export', () => {
  it('round-trips a project exactly', () => {
    const p = s().project
    const r = importProject(exportProject(p))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.project).toEqual(p)
  })
  it('rejects malformed files with a clear reason', () => {
    expect(importProject('not json')).toEqual({ ok: false, error: 'This file is not valid JSON.' })
    expect(validateProject({ schema: 2 })).toMatchObject({ ok: false })
    const p = structuredClone(s().project)
    p.layouts[0].furniture[0].width = -4
    const r = validateProject(p)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/non-positive/)
  })
  it('fills in missing settings from defaults', () => {
    const p = structuredClone(s().project) as unknown as Record<string, unknown>
    delete p.settings
    const r = validateProject(p)
    expect(r.ok && r.project.settings.rules.chairClearance).toBe(36)
  })
  it('falls back to the first layout when the active id is stale', () => {
    const p = structuredClone(s().project)
    p.activeLayoutId = 'nope'
    const r = validateProject(p)
    expect(r.ok && r.project.activeLayoutId).toBe(p.layouts[0].id)
  })
})
