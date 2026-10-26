import type { Poly } from '../geometry/polygon'
import type { FurnitureItem, Settings } from '../model/types'
import { computeChairZone, computeClearances, type ChairZone, type ClearanceEntry, type ClearanceStatus } from './clearance'
import { findCollisions, type Collision } from './collisions'
import type { Architecture } from './room'
import { buildObstacles, furniturePolygon } from './scene'

export interface FurnitureAnalysis {
  polygon: Poly
  collisions: Collision[]
  clearances: ClearanceEntry[]
  chairZone: ChairZone | null
  /** True when nothing overlaps (touching is fine). */
  fits: boolean
  nearestWall: ClearanceEntry | null
  nearestFurniture: ClearanceEntry | null
  /** The nearest gap that reads as tight, if any (informational: shown on its own dimension line). */
  tightest: ClearanceEntry | null
  /**
   * Overall verdict: collision (overlap, door swing blocked, or no room for a chair) > tight (chair space is
   * narrow) > good. Individual narrow gaps beside walls do not change it; they are coloured on their own lines.
   */
  status: ClearanceStatus
}

export interface AnalysisContext {
  arch: Architecture
  furniture: FurnitureItem[]
  settings: Pick<Settings, 'rules'>
}

export function analyseFurniture(item: FurnitureItem, ctx: AnalysisContext, polygon: Poly = furniturePolygon(item)): FurnitureAnalysis {
  const { arch, furniture, settings } = ctx
  const obstacles = buildObstacles(arch, furniture, settings, { exceptId: item.id })
  const collisions = item.collides ? findCollisions(polygon, obstacles, arch.room.polygon) : []
  const clearances = computeClearances(item.id, polygon, { arch, furniture, rules: settings.rules }, collisions)
  const chairObstacles = buildObstacles(arch, furniture, settings, { exceptId: item.id, includeChairs: false })
  const chairZone = computeChairZone(item, chairObstacles, arch.room.polygon, settings.rules)

  const nearestWall = clearances.find((c) => c.kind === 'wall' || c.kind === 'interior-wall') ?? null
  const nearestFurniture = clearances.find((c) => c.kind === 'furniture') ?? null
  const tightest = clearances.find((c) => c.status === 'tight') ?? null
  const fits = collisions.length === 0
  let status: ClearanceStatus = 'good'
  if (!fits || chairZone?.status === 'collision') status = 'collision'
  else if (chairZone?.status === 'tight') status = 'tight'
  return { polygon, collisions, clearances, chairZone, fits, nearestWall, nearestFurniture, tightest, status }
}

/** Collisions for every piece of furniture, so overlaps are visible without selecting anything. */
export function collisionMap(ctx: AnalysisContext): Map<string, Collision[]> {
  const out = new Map<string, Collision[]>()
  for (const f of ctx.furniture) {
    if (f.hidden || !f.collides) continue
    const obstacles = buildObstacles(ctx.arch, ctx.furniture, ctx.settings, { exceptId: f.id })
    const c = findCollisions(furniturePolygon(f), obstacles, ctx.arch.room.polygon)
    if (c.length) out.set(f.id, c)
  }
  return out
}
