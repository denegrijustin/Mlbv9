/**
 * Editing a room's custom outline. Corners are numbered in clockwise order and edge `i` (wall id `e<i>`) runs from
 * corner `i` to corner `i+1`. Doors, windows and TVs are attached to walls by id and measured along the wall from its
 * start corner, so any edit that renumbers or reshapes edges has to carry those attachments across — or, when it
 * cannot do so without guessing, detach them (they then show as "needs a wall") rather than move them silently.
 */
import { bbox } from '../geometry/polygon'
import { isAxisRect, orientClockwise } from '../geometry/outline'
import { dist, lerp, norm, sub, type Vec } from '../geometry/vec'
import type { ArchItem, DoorItem, Room } from './types'

type Attached = Extract<ArchItem, { wallId: string | null }>
const isAttached = (it: ArchItem): it is Attached => it.type === 'door' || it.type === 'window' || it.type === 'tv'

interface EdgeTarget {
  edge: number
  /** The new edge starts this far further along the old edge's direction (the offset shrinks by this much). */
  shift: number
  /** The new edge runs the opposite way to the old one. */
  reversed?: boolean
  /** Length of the new edge (needed when reversed). */
  length?: number
}
type EdgeMap = (oldEdge: number, offset: number | null, width: number | null) => EdgeTarget | null

const EDGE = /^e(\d+)$/

function remap(items: ArchItem[], map: EdgeMap): void {
  for (const it of items) {
    if (!isAttached(it) || !it.wallId) continue
    const m = EDGE.exec(it.wallId)
    if (!m) continue
    const target = map(Number(m[1]), it.offset, it.width)
    if (!target) {
      it.wallId = null
      continue
    }
    it.wallId = `e${target.edge}`
    if (target.reversed) {
      if (it.offset !== null && it.width !== null && target.length !== undefined) it.offset = target.length - it.offset - it.width
      else {
        it.offset = null
      }
      if (it.type === 'door') (it as DoorItem).hinge = (it as DoorItem).hinge === 'start' ? 'end' : 'start'
    } else if (it.offset !== null) {
      it.offset -= target.shift
      if (it.offset < -1e-9) {
        it.wallId = null
        it.offset = null
      }
    }
  }
}

export const edgeIndex = (wallId: string | null): number | null => {
  const m = wallId ? EDGE.exec(wallId) : null
  return m ? Number(m[1]) : null
}

/** Turn the width x depth rectangle into an editable 4-corner outline. Fails if either dimension is unmeasured. */
export function rectToOutline(room: Room): boolean {
  const W = room.width
  const D = room.depth
  if (W === null || D === null || W <= 0 || D <= 0) return false
  room.outline = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: D }, { x: 0, y: D }]
  const named: Record<string, EdgeTarget> = {
    north: { edge: 0, shift: 0 },
    east: { edge: 1, shift: 0 },
    south: { edge: 2, shift: 0, reversed: true, length: W },
    west: { edge: 3, shift: 0, reversed: true, length: D },
  }
  for (const it of room.items) {
    if (!isAttached(it) || !it.wallId || !named[it.wallId]) continue
    const t = named[it.wallId]
    it.wallId = `e${t.edge}`
    if (t.reversed) {
      it.offset = it.offset !== null && it.width !== null ? t.length! - it.offset - it.width : null
      if (it.type === 'door') it.hinge = it.hinge === 'start' ? 'end' : 'start'
    }
  }
  return true
}

/** Back to a rectangle. Only exact for an axis-aligned 4-corner outline; otherwise attached items are detached. */
export function outlineToRect(room: Room): void {
  const o = room.outline
  if (!o) return
  const b = bbox(o)
  const rect = isAxisRect(o)
  const side: Array<EdgeTarget & { id: string }> = []
  if (rect) {
    const poly = orientClockwise(o)
    for (let i = 0; i < 4; i++) {
      const a = poly[i]
      const c = poly[(i + 1) % 4]
      const d = norm(sub(c, a))
      // clockwise on screen: east-going edge is the north wall, south-going is east, west-going is south, north-going is west
      const id = d.x > 0.5 ? 'north' : d.y > 0.5 ? 'east' : d.x < -0.5 ? 'south' : 'west'
      side[i] = { id, edge: 0, shift: 0, reversed: id === 'south' || id === 'west', length: dist(a, c) }
    }
  }
  for (const it of room.items) {
    if (!isAttached(it) || !it.wallId) continue
    const i = edgeIndex(it.wallId)
    if (i === null) continue
    const t = rect ? side[i] : undefined
    if (!t) {
      it.wallId = null
      continue
    }
    if (t.reversed) {
      it.offset = it.offset !== null && it.width !== null ? t.length! - it.offset - it.width : null
      if (it.type === 'door') it.hinge = it.hinge === 'start' ? 'end' : 'start'
    }
    it.wallId = t.id
  }
  room.width = rect ? b.maxX - b.minX : b.maxX - b.minX
  room.depth = b.maxY - b.minY
  room.outline = null
}

/** Insert a corner at the midpoint of edge `i`. */
export function insertCorner(room: Room, i: number): boolean {
  const o = room.outline
  if (!o || i < 0 || i >= o.length) return false
  const a = o[i]
  const c = o[(i + 1) % o.length]
  const half = dist(a, c) / 2
  o.splice(i + 1, 0, lerp(a, c, 0.5))
  remap(room.items, (e, off, w) => {
    if (e < i) return { edge: e, shift: 0 }
    if (e > i) return { edge: e + 1, shift: 0 }
    return off !== null && w !== null && off >= half - 1e-9 ? { edge: i + 1, shift: half } : { edge: i, shift: 0 }
  })
  return true
}

/** Remove corner `i`, merging the two walls that met there. Anything attached to those two walls is detached. */
export function removeCorner(room: Room, i: number): boolean {
  const o = room.outline
  if (!o || o.length <= 3 || i < 0 || i >= o.length) return false
  const n = o.length
  const prev = (i - 1 + n) % n
  o.splice(i, 1)
  remap(room.items, (e) => (e === prev || e === i ? null : { edge: e > i ? e - 1 : e, shift: 0 }))
  return true
}

/**
 * Cut a rectangular notch out of the corner at `i`: `a` back along the wall that arrives at the corner and `b`
 * forward along the wall that leaves it. A 90° corner becomes an inside corner, turning a rectangle into an L.
 */
export function cutCorner(room: Room, i: number, a: number, b: number): string | null {
  const o = room.outline
  if (!o || i < 0 || i >= o.length) return 'There is no such corner.'
  const n = o.length
  const prev = o[(i - 1 + n) % n]
  const v = o[i]
  const next = o[(i + 1) % n]
  const lenIn = dist(prev, v)
  const lenOut = dist(v, next)
  if (!(a > 0) || !(b > 0)) return 'Enter both sizes of the notch.'
  if (a >= lenIn - 0.01) return `The notch is as long as the wall (${lenIn}"). Make it shorter.`
  if (b >= lenOut - 0.01) return `The notch is as long as the wall (${lenOut}"). Make it shorter.`
  const d0 = norm(sub(v, prev))
  const d1 = norm(sub(next, v))
  const p1: Vec = { x: v.x - d0.x * a, y: v.y - d0.y * a }
  const p2: Vec = { x: p1.x + d1.x * b, y: p1.y + d1.y * b }
  const p3: Vec = { x: v.x + d1.x * b, y: v.y + d1.y * b }
  o.splice(i, 1, p1, p2, p3)
  const prevEdgeNew = i === 0 ? n + 1 : i - 1
  remap(room.items, (e) => {
    if (e === (i - 1 + n) % n) return { edge: prevEdgeNew, shift: 0 }
    if (e === i) return { edge: i + 2, shift: b }
    return { edge: e > i ? e + 2 : e, shift: 0 }
  })
  return null
}

/** Translate everything in the project so the outline's bounding box starts at (0, 0). Returns the shift applied. */
export function normalizeOrigin(project: {
  room: Room
  layouts: Array<{ furniture: Array<{ x: number; y: number }> }>
  measurements: Array<{ a: Vec; b: Vec }>
  reference?: { x: number; y: number } | null
}): Vec {
  const o = project.room.outline
  if (!o) return { x: 0, y: 0 }
  const b = bbox(o)
  const dx = -b.minX
  const dy = -b.minY
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return { x: 0, y: 0 }
  for (const p of o) {
    p.x += dx
    p.y += dy
  }
  for (const w of project.room.interiorWalls) {
    w.a = { x: w.a.x + dx, y: w.a.y + dy }
    w.b = { x: w.b.x + dx, y: w.b.y + dy }
  }
  for (const it of project.room.items) {
    if ((it.type === 'pillar' || it.type === 'builtin') && it.x !== null && it.y !== null) {
      it.x += dx
      it.y += dy
    }
  }
  for (const l of project.layouts) for (const f of l.furniture) {
    f.x += dx
    f.y += dy
  }
  for (const m of project.measurements) {
    m.a = { x: m.a.x + dx, y: m.a.y + dy }
    m.b = { x: m.b.x + dx, y: m.b.y + dy }
  }
  if (project.reference) {
    project.reference.x += dx
    project.reference.y += dy
  }
  return { x: dx, y: dy }
}
