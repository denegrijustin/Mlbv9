/** Furniture geometry in room coordinates, and the obstacle set the engines test against. */
import { bbox, transformPoly, type BBox, type Poly } from '../geometry/polygon'
import { localPolygon } from '../geometry/shapes'
import type { Architecture } from './room'
import { interiorWallPolygon } from './room'
import type { FurnitureItem, Settings } from '../model/types'

export function furniturePolygon(item: FurnitureItem, over: Partial<Pick<FurnitureItem, 'x' | 'y' | 'rotation' | 'flipX' | 'flipY' | 'width' | 'depth'>> = {}): Poly {
  const m = { ...item, ...over }
  return transformPoly(localPolygon(m.shape, m.width, m.depth), { x: m.x, y: m.y, rotation: m.rotation, flipX: m.flipX, flipY: m.flipY })
}

export type ObstacleKind = 'interior-wall' | 'pillar' | 'builtin' | 'furniture' | 'door-swing'

export interface Obstacle {
  id: string
  kind: ObstacleKind
  label: string
  polygon: Poly
  box: BBox
}

const make = (id: string, kind: ObstacleKind, label: string, polygon: Poly): Obstacle => ({ id, kind, label, polygon, box: bbox(polygon) })

/**
 * Everything a piece of furniture must not overlap. Rugs (collides: false) and hidden items are skipped.
 * The room boundary is handled separately (see collisions.ts).
 */
export function buildObstacles(
  arch: Architecture,
  furniture: FurnitureItem[],
  settings: Pick<Settings, 'rules'>,
  opts: { exceptId?: string; includeChairs?: boolean } = {},
): Obstacle[] {
  const out: Obstacle[] = []
  for (const w of arch.room.walls) {
    if (w.kind === 'interior') out.push(make(w.id, 'interior-wall', w.name, interiorWallPolygon(w)))
  }
  for (const a of arch.arch) {
    if (!a.placed) continue
    if ((a.type === 'pillar' || a.type === 'builtin') && a.polygon) out.push(make(a.id, a.type, a.item.name, a.polygon))
    if (a.type === 'door' && a.swingZone && settings.rules.keepDoorSwingClear) out.push(make(`${a.id}:swing`, 'door-swing', `${a.item.name} swing`, a.swingZone))
  }
  for (const f of furniture) {
    if (f.id === opts.exceptId || f.hidden || !f.collides) continue
    if (f.role === 'chair' && opts.includeChairs === false) continue
    out.push(make(f.id, 'furniture', f.name, furniturePolygon(f)))
  }
  return out
}
