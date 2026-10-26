import { newId } from './ids'
import { SEED_DESK_TEMPLATE } from './library'
import { shapeExtent } from '../geometry/shapes'
import type { ArchItem, BuiltIn, DoorItem, FurnitureItem, FurnitureTemplate, InteriorWall, Layout, Pillar, Project, Room, Settings, WallTV, WindowItem } from './types'

export const DEFAULT_SETTINGS: Settings = {
  units: 'in',
  precision: 8,
  gridSize: 12,
  snapEnabled: true,
  snapWalls: true,
  snapEdges: true,
  snapCenters: true,
  snapGrid: false,
  snapThreshold: 3,
  rotationSnap: 15,
  collisionMode: 'warn',
  rules: { walkingPath: 30, comfortablePath: 36, chairClearance: 36, keepDoorSwingClear: true },
  showNames: true,
  showClearance: true,
  showChairZone: true,
}

export function makePillar(over: Partial<Pillar> = {}): Pillar {
  return { id: newId('pillar'), type: 'pillar', name: 'Pillar', locked: true, x: null, y: null, width: null, depth: null, rotation: 0, height: null, ...over }
}

export function makeBuiltIn(over: Partial<BuiltIn> = {}): BuiltIn {
  return { id: newId('builtin'), type: 'builtin', kind: 'bookcase', name: 'Built-in', locked: true, x: null, y: null, width: null, depth: null, rotation: 0, height: null, ...over }
}

export function makeDoor(over: Partial<DoorItem> = {}): DoorItem {
  return { id: newId('door'), type: 'door', style: 'door', name: 'Door', locked: true, wallId: null, offset: null, width: null, height: null, hinge: 'start', swing: 'in', ...over }
}

export function makeWindow(over: Partial<WindowItem> = {}): WindowItem {
  return { id: newId('window'), type: 'window', name: 'Window', locked: true, wallId: null, offset: null, width: null, sill: null, height: null, ...over }
}

export function makeWallTV(over: Partial<WallTV> = {}): WallTV {
  return { id: newId('tv'), type: 'tv', name: 'Wall-mounted TV', locked: true, wallId: null, offset: null, width: null, thickness: null, mountHeight: null, height: null, ...over }
}

export function makeInteriorWall(over: Partial<InteriorWall> = {}): InteriorWall {
  return { id: newId('wall'), name: 'Interior wall', a: { x: 0, y: 0 }, b: { x: 48, y: 0 }, thickness: 4.5, locked: false, ...over }
}

export function makeArch(type: ArchItem['type'], over: Partial<ArchItem> = {}): ArchItem {
  switch (type) {
    case 'pillar':
      return makePillar(over as Partial<Pillar>)
    case 'builtin':
      return makeBuiltIn(over as Partial<BuiltIn>)
    case 'door':
      return makeDoor(over as Partial<DoorItem>)
    case 'window':
      return makeWindow(over as Partial<WindowItem>)
    case 'tv':
      return makeWallTV(over as Partial<WallTV>)
  }
}

export function furnitureFromTemplate(tpl: FurnitureTemplate, at: { x: number; y: number }): FurnitureItem {
  const ext = shapeExtent(tpl.shape, tpl.width, tpl.depth)
  return {
    id: newId('f'),
    name: tpl.name,
    category: tpl.category,
    templateId: tpl.id,
    x: at.x,
    y: at.y,
    rotation: 0,
    flipX: false,
    flipY: false,
    width: ext.width,
    depth: ext.depth,
    height: tpl.height,
    shape: structuredClone(tpl.shape),
    color: tpl.color,
    workSide: tpl.workSide,
    collides: tpl.collides,
    ...(tpl.role ? { role: tpl.role } : {}),
    locked: false,
    hidden: false,
  }
}

/**
 * The seed office. The only architectural measurement supplied so far is one primary dimension, 101 inches, which is
 * entered as the room width (swap it with the depth in Room settings if it is the other way round). Everything else
 * is left unmeasured (null): the app flags it and asks, rather than guessing from photographs.
 */
export function createSeedRoom(): Room {
  return {
    id: newId('room'),
    name: 'Office',
    width: 101,
    depth: 102,
    ceilingHeight: null,
    floor: 'carpet',
    wallThickness: 4.5,
    interiorWalls: [],
    items: [
      makeWindow({ name: 'Window' }),
      makeDoor({ name: 'Doorway', style: 'opening' }),
      makePillar({ name: 'Wood pillar / column', width: 24 }),
      makeBuiltIn({ name: 'Built-in bookcases', kind: 'bookcase' }),
      makeWallTV({ name: 'Wall-mounted TV' }),
    ],
  }
}

export function createSeedProject(): Project {
  const layoutId = newId('layout')
  // Initial placement is just a starting point near the north wall, not a measurement. Drag it anywhere.
  const desk = furnitureFromTemplate(SEED_DESK_TEMPLATE, { x: 40, y: 28 })
  desk.name = 'L-shaped standing desk'
  const layout: Layout = { id: layoutId, name: 'Layout A', furniture: [desk] }
  return {
    schema: 1,
    id: newId('project'),
    name: 'Office Layout',
    room: createSeedRoom(),
    layouts: [layout],
    activeLayoutId: layoutId,
    customTemplates: [SEED_DESK_TEMPLATE],
    measurements: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    updatedAt: Date.now(),
  }
}
