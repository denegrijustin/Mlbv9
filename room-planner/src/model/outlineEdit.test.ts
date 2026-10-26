import { describe, expect, it } from 'vitest'
import { resolveArchitecture } from '../engine/room'
import { makeDoor } from './defaults'
import { cutCorner, insertCorner, outlineToRect, rectToOutline, removeCorner } from './outlineEdit'
import type { DoorItem, Room } from './types'
import { baselineSeedRoom } from './testSeed'

const room = (): Room => {
  const r = baselineSeedRoom()
  r.width = 120
  r.depth = 100
  r.items = []
  return r
}

describe('outline rooms', () => {
  it('converts a measured rectangle and keeps attached items in the same place', () => {
    const r = room()
    const d = makeDoor({ wallId: 'south', offset: 10, width: 30, hinge: 'start', style: 'door' }) as DoorItem
    r.items.push(d)
    const before = resolveArchitecture(r).arch[0].segment!
    expect(rectToOutline(r)).toBe(true)
    const after = resolveArchitecture(r).arch[0]
    expect(after.placed).toBe(true)
    const pts = [after.segment!.a, after.segment!.b].map((p) => `${p.x},${p.y}`).sort()
    expect(pts).toEqual([before.a, before.b].map((p) => `${p.x},${p.y}`).sort())
    expect((r.items[0] as DoorItem).hinge).toBe('end')
  })

  it('refuses to convert while a dimension is unmeasured', () => {
    const r = baselineSeedRoom()
    expect(rectToOutline(r)).toBe(false)
    expect(r.outline).toBeFalsy()
  })

  it('cutting a corner makes an L-shaped floor with the right area and carries items across', () => {
    const r = room()
    r.items.push(makeDoor({ wallId: 'east', offset: 60, width: 30, style: 'opening' }))
    rectToOutline(r)
    // cut 40 x 30 out of the north-east corner (corner index 1)
    expect(cutCorner(r, 1, 40, 30)).toBeNull()
    const a = resolveArchitecture(r)
    const area = Math.abs(a.room.polygon.reduce((s, p, i) => { const q = a.room.polygon[(i + 1) % a.room.polygon.length]; return s + p.x * q.y - q.x * p.y }, 0) / 2)
    expect(area).toBe(120 * 100 - 40 * 30)
    expect(a.room.polygon.length).toBe(6)
    // the door was 60" down the old east wall, which now starts 30" lower: it is 30" along the new wall
    const it = r.items[0] as DoorItem
    expect(it.wallId).toBe('e3')
    expect(it.offset).toBe(30)
    expect(a.arch[0].placed).toBe(true)
  })

  it('rejects a notch as long as the wall', () => {
    const r = room()
    rectToOutline(r)
    expect(cutCorner(r, 0, 120, 10)).toMatch(/as long as the wall/)
  })

  it('inserting a corner splits a wall and moves later attachments onto the right half', () => {
    const r = room()
    r.items.push(makeDoor({ wallId: 'north', offset: 80, width: 20, style: 'opening' }))
    rectToOutline(r)
    insertCorner(r, 0)
    const it = r.items[0] as DoorItem
    expect(it.wallId).toBe('e1')
    expect(it.offset).toBe(20)
    expect(r.outline!.length).toBe(5)
  })

  it('removing a corner detaches items on the merged walls instead of guessing', () => {
    const r = room()
    r.items.push(makeDoor({ wallId: 'north', offset: 10, width: 20, style: 'opening' }))
    rectToOutline(r)
    insertCorner(r, 2)
    expect(removeCorner(r, 3)).toBe(true)
    expect(r.outline!.length).toBe(4)
    expect((r.items[0] as DoorItem).wallId).toBe('e0')
    removeCorner(r, 1)
    expect((r.items[0] as DoorItem).wallId).toBeNull()
  })

  it('reverts an axis-aligned outline to a rectangle with items intact', () => {
    const r = room()
    r.items.push(makeDoor({ wallId: 'west', offset: 10, width: 30, hinge: 'end', style: 'door' }))
    rectToOutline(r)
    outlineToRect(r)
    const it = r.items[0] as DoorItem
    expect(r.outline).toBeNull()
    expect([it.wallId, it.offset, it.hinge]).toEqual(['west', 10, 'end'])
  })

  it('flags a self-crossing outline', () => {
    const r = room()
    r.outline = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }]
    expect(resolveArchitecture(r).issues.some((i) => i.severity === 'error' && /crosses/.test(i.message))).toBe(true)
  })
})
