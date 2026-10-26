/**
 * Turns the stored room (inches, possibly with unmeasured values) into geometry the planner can draw and test against.
 *
 * Nothing here ever changes a measurement. When something is missing it is reported as "unresolved"; when measurements
 * contradict each other it is reported as an issue that names the measurements involved.
 */
import { intersect, subtract } from '../geometry/clip'
import { pointInPolygon, rectPoly, rotatedRect, thickSegment, type Poly } from '../geometry/polygon'
import { add, angleDiff, mul, norm, perp, sub, type Vec } from '../geometry/vec'
import { formatLength } from '../geometry/units'
import type { ArchItem, ArchType, BuiltIn, DoorItem, Pillar, Room, WallId, WallTV, WindowItem } from '../model/types'

/**
 * Stand-in for a dimension that has not been measured. It lets open sides extend off-screen. It is never displayed
 * as a measurement and nothing is ever "fitted" to it.
 */
export const OPEN_EXTENT = 1200

const EPS = 1e-6
const OVERLAP_TOLERANCE = 0.05 // square inches

export interface ResolvedWall {
  id: WallId
  name: string
  kind: 'perimeter' | 'interior'
  /** Perimeter: on the interior face. Interior: on the centre line. */
  a: Vec
  b: Vec
  /** Unit direction of offsets along the wall (north/south: west to east; east/west: north to south). */
  dir: Vec
  /** Unit vector pointing into the room (perimeter) or to the left of `dir` (interior). */
  normalIn: Vec
  /** null when an end of the wall depends on an unmeasured dimension. */
  length: number | null
  unbounded: boolean
  thickness: number
}

export interface ResolvedRoom {
  width: number | null
  depth: number | null
  complete: boolean
  /** Interior floor polygon. Unmeasured sides extend to OPEN_EXTENT. */
  polygon: Poly
  /** Walls that exist given what has been measured. */
  walls: ResolvedWall[]
  wallById: Map<WallId, ResolvedWall>
  openSides: Array<'east' | 'south'>
}

export interface ResolvedArch {
  id: string
  item: ArchItem
  type: ArchType
  /** Measurements still needed to draw it on the plan. */
  missing: string[]
  /** Measurements still needed only for the 3D view. */
  missingOptional: string[]
  placed: boolean
  /** Floor footprint (pillars, built-ins, wall TVs with a known projection). */
  polygon: Poly | null
  wall: ResolvedWall | null
  /** The span along the wall (doors, windows, TVs). */
  segment: { a: Vec; b: Vec } | null
  /** Region swept by an opening door leaf. */
  swingZone: Poly | null
  leaf: { hinge: Vec; tip: Vec } | null
}

export interface Issue {
  id: string
  severity: 'error' | 'warning' | 'info'
  message: string
  /** Ids of the architectural items (or 'room') involved, so the canvas can flag them. */
  itemIds: string[]
  /** The specific measurements that conflict. */
  measurements: string[]
}

export interface UnresolvedEntry {
  id: string
  name: string
  type: ArchType | 'room'
  missing: string[]
  missingOptional: string[]
}

export interface Architecture {
  room: ResolvedRoom
  arch: ResolvedArch[]
  issues: Issue[]
  unresolved: UnresolvedEntry[]
}

const fmt = (n: number) => formatLength(n, { denom: 8 })

export function resolveRoom(room: Room): ResolvedRoom {
  const W = room.width
  const D = room.depth
  const We = W ?? OPEN_EXTENT
  const De = D ?? OPEN_EXTENT
  const t = room.wallThickness
  const walls: ResolvedWall[] = []

  walls.push({
    id: 'north', name: 'North wall', kind: 'perimeter',
    a: { x: 0, y: 0 }, b: { x: We, y: 0 }, dir: { x: 1, y: 0 }, normalIn: { x: 0, y: 1 },
    length: W, unbounded: W === null, thickness: t,
  })
  walls.push({
    id: 'west', name: 'West wall', kind: 'perimeter',
    a: { x: 0, y: 0 }, b: { x: 0, y: De }, dir: { x: 0, y: 1 }, normalIn: { x: 1, y: 0 },
    length: D, unbounded: D === null, thickness: t,
  })
  if (W !== null) {
    walls.push({
      id: 'east', name: 'East wall', kind: 'perimeter',
      a: { x: W, y: 0 }, b: { x: W, y: De }, dir: { x: 0, y: 1 }, normalIn: { x: -1, y: 0 },
      length: D, unbounded: D === null, thickness: t,
    })
  }
  if (D !== null) {
    walls.push({
      id: 'south', name: 'South wall', kind: 'perimeter',
      a: { x: 0, y: D }, b: { x: We, y: D }, dir: { x: 1, y: 0 }, normalIn: { x: 0, y: -1 },
      length: W, unbounded: W === null, thickness: t,
    })
  }
  for (const w of room.interiorWalls) {
    const dir = norm(sub(w.b, w.a))
    walls.push({
      id: w.id, name: w.name, kind: 'interior', a: w.a, b: w.b, dir, normalIn: perp(dir),
      length: Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), unbounded: false, thickness: w.thickness,
    })
  }
  const openSides: Array<'east' | 'south'> = []
  if (W === null) openSides.push('east')
  if (D === null) openSides.push('south')
  return {
    width: W,
    depth: D,
    complete: W !== null && D !== null,
    polygon: rectPoly(0, 0, We, De),
    walls,
    wallById: new Map(walls.map((w) => [w.id, w])),
    openSides,
  }
}

/** The solid footprint of an interior wall (for collisions and drawing). */
export function interiorWallPolygon(w: ResolvedWall): Poly {
  return thickSegment(w.a, w.b, w.thickness)
}

/** Quarter-circle region swept by a door leaf hinged at `hinge`, from `from` direction to `to` direction. */
export function swingSector(hinge: Vec, from: Vec, to: Vec, radius: number, steps = 18): Poly {
  const a0 = Math.atan2(from.y, from.x)
  const a1 = Math.atan2(to.y, to.x)
  const sweep = (angleDiff((a1 * 180) / Math.PI, (a0 * 180) / Math.PI) * Math.PI) / 180
  const pts: Vec[] = [hinge]
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps
    pts.push({ x: hinge.x + radius * Math.cos(a), y: hinge.y + radius * Math.sin(a) })
  }
  return pts
}

const WALL_LABELS = { wall: 'Wall', offset: 'Position along wall', width: 'Width' }

function attachedGeometry(
  item: DoorItem | WindowItem | WallTV,
  room: Room,
  rr: ResolvedRoom,
  missing: string[],
): { wall: ResolvedWall | null; segment: { a: Vec; b: Vec } | null } {
  if (item.wallId === null) missing.push(WALL_LABELS.wall)
  if (item.offset === null) missing.push(WALL_LABELS.offset)
  if (item.width === null) missing.push(WALL_LABELS.width)
  if (item.wallId === null) return { wall: null, segment: null }
  const wall = rr.wallById.get(item.wallId) ?? null
  if (!wall) {
    // The wall is a perimeter wall that cannot exist yet because a room dimension is unmeasured.
    if (item.wallId === 'east') missing.push('Room width (needed for the east wall)')
    else if (item.wallId === 'south') missing.push('Room depth (needed for the south wall)')
    else missing.push('Wall no longer exists')
    return { wall: null, segment: null }
  }
  void room
  if (item.offset === null || item.width === null) return { wall, segment: null }
  const a = add(wall.a, mul(wall.dir, item.offset))
  const b = add(a, mul(wall.dir, item.width))
  return { wall, segment: { a, b } }
}

export function resolveArch(item: ArchItem, room: Room, rr: ResolvedRoom): ResolvedArch {
  const base: ResolvedArch = {
    id: item.id, item, type: item.type, missing: [], missingOptional: [], placed: false,
    polygon: null, wall: null, segment: null, swingZone: null, leaf: null,
  }
  switch (item.type) {
    case 'pillar':
    case 'builtin': {
      const it = item as Pillar | BuiltIn
      if (it.x === null) base.missing.push('Distance from west wall')
      if (it.y === null) base.missing.push('Distance from north wall')
      if (it.width === null) base.missing.push('Width')
      if (it.depth === null) base.missing.push('Depth')
      if (it.height === null) base.missingOptional.push('Height')
      if (base.missing.length === 0) {
        base.polygon = rotatedRect(it.x! + it.width! / 2, it.y! + it.depth! / 2, it.width!, it.depth!, it.rotation)
        base.placed = true
      }
      return base
    }
    case 'door': {
      const it = item as DoorItem
      const g = attachedGeometry(it, room, rr, base.missing)
      base.wall = g.wall
      base.segment = g.segment
      base.placed = base.missing.length === 0 && g.segment !== null
      if (it.height === null) base.missingOptional.push('Height')
      if (base.placed && it.style === 'door' && g.wall && g.segment) {
        const hinge = it.hinge === 'start' ? g.segment.a : g.segment.b
        const closedDir = it.hinge === 'start' ? g.wall.dir : mul(g.wall.dir, -1)
        const openDir = it.swing === 'in' ? g.wall.normalIn : mul(g.wall.normalIn, -1)
        base.swingZone = swingSector(hinge, closedDir, openDir, it.width!)
        base.leaf = { hinge, tip: add(hinge, mul(openDir, it.width!)) }
      }
      return base
    }
    case 'window': {
      const it = item as WindowItem
      const g = attachedGeometry(it, room, rr, base.missing)
      base.wall = g.wall
      base.segment = g.segment
      base.placed = base.missing.length === 0 && g.segment !== null
      if (it.sill === null) base.missingOptional.push('Sill height')
      if (it.height === null) base.missingOptional.push('Height')
      return base
    }
    case 'tv': {
      const it = item as WallTV
      const g = attachedGeometry(it, room, rr, base.missing)
      base.wall = g.wall
      base.segment = g.segment
      base.placed = base.missing.length === 0 && g.segment !== null
      if (it.thickness === null) base.missingOptional.push('Projection from wall')
      if (it.mountHeight === null) base.missingOptional.push('Mounting height')
      if (it.height === null) base.missingOptional.push('Screen height')
      if (base.placed && it.thickness !== null && g.wall && g.segment) {
        const n = mul(g.wall.normalIn, it.thickness)
        base.polygon = [g.segment.a, g.segment.b, add(g.segment.b, n), add(g.segment.a, n)]
      }
      return base
    }
  }
}

export function resolveArchitecture(room: Room): Architecture {
  const rr = resolveRoom(room)
  const arch = room.items.map((it) => resolveArch(it, room, rr))
  const issues: Issue[] = []
  const unresolved: UnresolvedEntry[] = []

  const roomMissing: string[] = []
  if (room.width === null) roomMissing.push('Width (east–west)')
  if (room.depth === null) roomMissing.push('Depth (north–south)')
  if (roomMissing.length) unresolved.push({ id: 'room', name: 'Room dimensions', type: 'room', missing: roomMissing, missingOptional: [] })
  for (const a of arch) {
    if (a.missing.length || a.missingOptional.length) {
      unresolved.push({ id: a.id, name: a.item.name, type: a.type, missing: a.missing, missingOptional: a.missingOptional })
    }
  }

  // ---- Room-level sanity
  if (room.width !== null && room.width <= 0) {
    issues.push({ id: 'room-width', severity: 'error', message: 'Room width must be greater than 0.', itemIds: ['room'], measurements: ['Room width'] })
  }
  if (room.depth !== null && room.depth <= 0) {
    issues.push({ id: 'room-depth', severity: 'error', message: 'Room depth must be greater than 0.', itemIds: ['room'], measurements: ['Room depth'] })
  }

  // ---- Interior walls
  for (const w of room.interiorWalls) {
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
    if (len < 1) {
      issues.push({ id: `wall-len-${w.id}`, severity: 'error', message: `"${w.name}" is shorter than 1" — set its length.`, itemIds: [w.id], measurements: [`${w.name} length`] })
    }
    for (const [label, p] of [['start', w.a], ['end', w.b]] as const) {
      if (!pointInPolygon(p, rr.polygon)) {
        issues.push({
          id: `wall-out-${w.id}-${label}`, severity: 'error',
          message: `"${w.name}" ${label} point is outside the room. Check the wall's position and the room dimensions.`,
          itemIds: [w.id, 'room'], measurements: [`${w.name} ${label} point`, 'Room width', 'Room depth'],
        })
      }
    }
  }

  // ---- Attached items: bounds along the wall, and overlaps on the same wall
  const intervals = new Map<WallId, Array<{ a: ResolvedArch; from: number; to: number }>>()
  for (const a of arch) {
    if (a.type !== 'door' && a.type !== 'window' && a.type !== 'tv') continue
    const it = a.item as DoorItem | WindowItem | WallTV
    if (it.wallId === null || it.offset === null || it.width === null) continue
    if (it.width <= 0) {
      issues.push({ id: `w-${it.id}`, severity: 'error', message: `"${it.name}" width must be greater than 0.`, itemIds: [it.id], measurements: [`${it.name} width`] })
      continue
    }
    if (it.offset < -EPS) {
      issues.push({ id: `o-${it.id}`, severity: 'error', message: `"${it.name}" position along the wall cannot be negative.`, itemIds: [it.id], measurements: [`${it.name} position`] })
    }
    const wall = a.wall
    if (wall && wall.length !== null && it.offset + it.width > wall.length + EPS) {
      issues.push({
        id: `fit-${it.id}`, severity: 'error',
        message: `"${it.name}" does not fit on the ${wall.name.toLowerCase()}: position ${fmt(it.offset)} + width ${fmt(it.width)} = ${fmt(it.offset + it.width)}, but the wall is only ${fmt(wall.length)} long.`,
        itemIds: [it.id], measurements: [`${it.name} position`, `${it.name} width`, `${wall.name} length`],
      })
    }
    const list = intervals.get(it.wallId) ?? []
    list.push({ a, from: it.offset, to: it.offset + it.width })
    intervals.set(it.wallId, list)
  }
  for (const [wallId, list] of intervals) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i]
        const B = list[j]
        if (Math.min(A.to, B.to) - Math.max(A.from, B.from) > EPS) {
          issues.push({
            id: `ovl-${A.a.id}-${B.a.id}`, severity: 'warning',
            message: `"${A.a.item.name}" and "${B.a.item.name}" overlap along the ${rr.wallById.get(wallId)?.name.toLowerCase() ?? 'wall'}. Check their positions and widths.`,
            itemIds: [A.a.id, B.a.id], measurements: [`${A.a.item.name} position`, `${A.a.item.name} width`, `${B.a.item.name} position`, `${B.a.item.name} width`],
          })
        }
      }
    }
  }

  // ---- Solid footprints: inside the room, and not overlapping each other
  const solids = arch.filter((a) => (a.type === 'pillar' || a.type === 'builtin') && a.polygon)
  for (const s of solids) {
    const outside = subtract(s.polygon!, rr.polygon)
    if (outside.area > OVERLAP_TOLERANCE) {
      issues.push({
        id: `out-${s.id}`, severity: 'error',
        message: `"${s.item.name}" extends outside the room by about ${Math.round(outside.area)} sq in. Check its position and size against the room dimensions.`,
        itemIds: [s.id, 'room'], measurements: [`${s.item.name} position`, `${s.item.name} size`, 'Room width', 'Room depth'],
      })
    }
  }
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const ov = intersect(solids[i].polygon!, solids[j].polygon!)
      if (ov.area > OVERLAP_TOLERANCE) {
        issues.push({
          id: `solid-${solids[i].id}-${solids[j].id}`, severity: 'warning',
          message: `"${solids[i].item.name}" and "${solids[j].item.name}" overlap by about ${Math.round(ov.area)} sq in. Solid objects cannot occupy the same space — check both measurements.`,
          itemIds: [solids[i].id, solids[j].id], measurements: [`${solids[i].item.name} position`, `${solids[i].item.name} size`, `${solids[j].item.name} position`, `${solids[j].item.name} size`],
        })
      }
    }
  }

  // ---- Door swings that hit fixed objects
  for (const d of arch) {
    if (!d.swingZone) continue
    for (const s of solids) {
      const ov = intersect(d.swingZone, s.polygon!)
      if (ov.area > OVERLAP_TOLERANCE) {
        issues.push({
          id: `swing-${d.id}-${s.id}`, severity: 'warning',
          message: `The swing of "${d.item.name}" runs into "${s.item.name}". Check the door width, hinge side and swing direction.`,
          itemIds: [d.id, s.id], measurements: [`${d.item.name} width`, `${d.item.name} hinge`, `${d.item.name} swing`, `${s.item.name} position`],
        })
      }
    }
  }

  return { room: rr, arch, issues, unresolved }
}
