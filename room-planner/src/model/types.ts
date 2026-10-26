/**
 * The scene model. This is the single source of truth: everything is stored in inches, in room coordinates
 * (origin = the room's north-west interior corner, +x east/right, +y south/down). Pixels never appear here.
 *
 * A measurement that has not been supplied is `null`. It is never guessed or inferred from a photograph.
 */
import type { Shape } from '../geometry/shapes'
import type { UnitSystem } from '../geometry/units'
import type { Vec } from '../geometry/vec'

export type Dim = number | null

/** 'north' | 'east' | 'south' | 'west' for the perimeter, or the id of an interior wall. */
export type WallId = string

export const PERIMETER_WALLS = ['north', 'east', 'south', 'west'] as const
export type PerimeterWallId = (typeof PERIMETER_WALLS)[number]

export interface InteriorWall {
  id: string
  name: string
  /** Centre-line end points, in inches from the north-west interior corner. */
  a: Vec
  b: Vec
  thickness: number
  locked: boolean
}

interface ArchBase {
  id: string
  name: string
  locked: boolean
  notes?: string
}

/** Fixed rectangular architectural element (pillar, built-in). x/y are the top-left corner before rotation. */
export interface RectArch extends ArchBase {
  x: Dim
  y: Dim
  width: Dim
  depth: Dim
  /** Degrees about the rectangle centre. */
  rotation: number
  /** Floor-to-top height, used by the 3D view. */
  height: Dim
}

export interface Pillar extends RectArch {
  type: 'pillar'
}

export type BuiltInKind = 'bookcase' | 'closet' | 'cabinet' | 'other'

export interface BuiltIn extends RectArch {
  type: 'builtin'
  kind: BuiltInKind
}

export interface DoorItem extends ArchBase {
  type: 'door'
  /** 'door' has a leaf and swing; 'opening' is a plain doorway/cased opening. */
  style: 'door' | 'opening'
  wallId: WallId | null
  /** Distance along the wall (from its start) to the nearest edge of the opening. */
  offset: Dim
  width: Dim
  height: Dim
  /** Which end of the opening carries the hinge. */
  hinge: 'start' | 'end'
  /** 'in' swings toward the room interior side of the wall; 'out' the other way. */
  swing: 'in' | 'out'
}

export interface WindowItem extends ArchBase {
  type: 'window'
  wallId: WallId | null
  offset: Dim
  width: Dim
  /** Floor to bottom of glass. */
  sill: Dim
  height: Dim
}

export interface WallTV extends ArchBase {
  type: 'tv'
  wallId: WallId | null
  offset: Dim
  width: Dim
  /** How far it projects from the wall. */
  thickness: Dim
  /** Floor to bottom of the screen. */
  mountHeight: Dim
  height: Dim
}

export type ArchItem = Pillar | BuiltIn | DoorItem | WindowItem | WallTV
export type ArchType = ArchItem['type']

export type FloorType = 'carpet' | 'wood' | 'tile' | 'other'

export interface Room {
  id: string
  name: string
  /** East-west interior dimension (the one measurement supplied for the seed office). */
  width: Dim
  /** North-south interior dimension. */
  depth: Dim
  ceilingHeight: Dim
  floor: FloorType
  /** Display only: drawn outside the interior boundary. Interior dimensions are always finished-surface to finished-surface. */
  wallThickness: number
  interiorWalls: InteriorWall[]
  items: ArchItem[]
  /**
   * Custom floor outline (corners in inches, any number >= 3). When set it replaces the width x depth rectangle:
   * `width`/`depth` then describe its bounding box and each edge i is the wall `e<i>`. Null/absent = rectangle.
   */
  outline?: Vec[] | null
}

export type FurnitureCategory = 'Office' | 'Bedroom' | 'Living Room' | 'Storage' | 'Lighting' | 'Plants' | 'Electronics' | 'Custom'
export const FURNITURE_CATEGORIES: FurnitureCategory[] = ['Office', 'Bedroom', 'Living Room', 'Storage', 'Lighting', 'Plants', 'Electronics', 'Custom']

/** Which side of the object a person sits or works on, for chair-clearance analysis. */
export type WorkSide = 'none' | 'front' | 'ldesk'

export interface FurnitureTemplate {
  id: string
  name: string
  category: FurnitureCategory
  width: number
  depth: number
  height: number
  shape: Shape
  color: string
  workSide: WorkSide
  /** false for rugs and similar floor coverings that other furniture may sit on. */
  collides: boolean
  /** 'chair' items may sit inside a desk's chair-clearance zone without blocking it. */
  role?: 'chair'
  custom?: boolean
}

export interface FurnitureItem {
  id: string
  name: string
  category: FurnitureCategory
  templateId?: string
  /** Position of the object's origin (centre of its footprint's bounding box), in inches. */
  x: number
  y: number
  /** Degrees, clockwise-positive. */
  rotation: number
  flipX: boolean
  flipY: boolean
  /** For rect/ellipse: the footprint size. For polygon/ldesk these mirror the footprint's bounding box. */
  width: number
  depth: number
  height: number
  shape: Shape
  color: string
  workSide: WorkSide
  collides: boolean
  role?: 'chair'
  locked: boolean
  hidden: boolean
  notes?: string
}

export interface Layout {
  id: string
  name: string
  furniture: FurnitureItem[]
}

export interface Measurement {
  id: string
  a: Vec
  b: Vec
}

export type RotationSnap = 0 | 15 | 45 | 90
export type GridSize = 0 | 1 | 3 | 6 | 12
export type CollisionMode = 'warn' | 'prevent'

export interface ClearanceRules {
  /** Minimum width of a walking path. */
  walkingPath: number
  /** A comfortable walking path. */
  comfortablePath: number
  /** Free space needed behind a desk for an office chair. */
  chairClearance: number
  /** Treat the door swing as a no-go zone. */
  keepDoorSwingClear: boolean
}

export interface Settings {
  units: UnitSystem
  /** Smallest fraction shown in labels. */
  precision: 2 | 4 | 8 | 16
  gridSize: GridSize
  snapEnabled: boolean
  snapWalls: boolean
  snapEdges: boolean
  snapCenters: boolean
  snapGrid: boolean
  /** Magnetic distance in inches. */
  snapThreshold: number
  rotationSnap: RotationSnap
  collisionMode: CollisionMode
  rules: ClearanceRules
  showNames: boolean
  showClearance: boolean
  showChairZone: boolean
}

/** A photograph or drawing placed under the plan for tracing. It is never used to derive a dimension on its own. */
export interface ReferenceImage {
  /** Downscaled JPEG/PNG data URL. */
  dataUrl: string
  naturalWidth: number
  naturalHeight: number
  /** Top-left corner of the image in plan inches (before rotation). */
  x: number
  y: number
  /** Real inches per image pixel. Only trustworthy once `calibrated`. */
  inchesPerPixel: number
  calibrated: boolean
  /** Degrees about the image centre. */
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  name: string
}

export interface Project {
  schema: 1
  id: string
  name: string
  room: Room
  layouts: Layout[]
  activeLayoutId: string
  customTemplates: FurnitureTemplate[]
  measurements: Measurement[]
  reference?: ReferenceImage | null
  settings: Settings
  updatedAt: number
}
