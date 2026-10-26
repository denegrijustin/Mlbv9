import { bbox, bboxCenter, bboxSize, type Poly } from './polygon'
import type { Vec } from './vec'

/**
 * Furniture footprints. All vertices are in inches, relative to the object's origin, which is the centre of the
 * footprint's bounding box (so rotation pivots about the visual middle). Flips mirror about that origin.
 */
export interface RectShape {
  kind: 'rect'
}
export interface EllipseShape {
  kind: 'ellipse'
}
export interface PolygonShape {
  kind: 'polygon'
  vertices: Vec[]
}

/** Parametric L-shaped desk. The footprint is a real polygon with a rounded inside corner, not two rectangles. */
export interface LDeskShape {
  kind: 'ldesk'
  /** Length of the main (horizontal) run. */
  mainLength: number
  /** Depth of the main run. */
  mainDepth: number
  /** Length of the return/side section. See returnMeasure. */
  returnLength: number
  /** Width of the narrow return section. */
  returnWidth: number
  /** Radius of the curved inside corner. */
  innerRadius: number
  /** Which end of the main run the return hangs from (unflipped). */
  returnSide: 'left' | 'right'
  /**
   * 'outer': returnLength is the overall length along the outside edge (includes the main run depth).
   * 'beyond': returnLength is how far the return extends past the main run.
   */
  returnMeasure: 'outer' | 'beyond'
}

export type Shape = RectShape | EllipseShape | PolygonShape | LDeskShape

const ARC_STEPS = 16
const ELLIPSE_STEPS = 48

export interface LDeskIssue {
  field: keyof LDeskShape
  message: string
}

/** Overall bounding depth of the L (the length of the outer return edge). */
export function lDeskOverallDepth(s: LDeskShape): number {
  return s.returnMeasure === 'outer' ? s.returnLength : s.mainDepth + s.returnLength
}

export function validateLDesk(s: LDeskShape): LDeskIssue[] {
  const issues: LDeskIssue[] = []
  const overall = lDeskOverallDepth(s)
  if (!(s.mainLength > 0)) issues.push({ field: 'mainLength', message: 'Main length must be greater than 0.' })
  if (!(s.mainDepth > 0)) issues.push({ field: 'mainDepth', message: 'Main depth must be greater than 0.' })
  if (!(s.returnWidth > 0)) issues.push({ field: 'returnWidth', message: 'Return width must be greater than 0.' })
  if (s.returnWidth >= s.mainLength) issues.push({ field: 'returnWidth', message: 'Return width must be less than the main length.' })
  if (overall <= s.mainDepth) issues.push({ field: 'returnLength', message: 'Return length must extend past the main run depth.' })
  const maxR = Math.max(0, Math.min(s.mainLength - s.returnWidth, overall - s.mainDepth))
  if (s.innerRadius < 0) issues.push({ field: 'innerRadius', message: 'Inner radius cannot be negative.' })
  if (s.innerRadius > maxR + 1e-9) issues.push({ field: 'innerRadius', message: `Inner radius is too large for these dimensions (max ${maxR}").` })
  return issues
}

/** Footprint of the L-shaped desk, clockwise on screen, centred on its bounding box. */
export function lDeskPolygon(s: LDeskShape): Poly {
  const L = s.mainLength
  const Dm = s.mainDepth
  const R = lDeskOverallDepth(s)
  const Wr = s.returnWidth
  const maxR = Math.max(0, Math.min(L - Wr, R - Dm))
  const r = Math.min(Math.max(0, s.innerRadius), maxR)

  // Unflipped layout: return hangs from the LEFT end. Origin at the outer top-left corner.
  const pts: Vec[] = [
    { x: 0, y: 0 },
    { x: L, y: 0 },
    { x: L, y: Dm },
  ]
  if (r > 1e-9) {
    pts.push({ x: Wr + r, y: Dm })
    const cx = Wr + r
    const cy = Dm + r
    for (let i = 1; i < ARC_STEPS; i++) {
      const th = -Math.PI / 2 - (Math.PI / 2) * (i / ARC_STEPS)
      pts.push({ x: cx + r * Math.cos(th), y: cy + r * Math.sin(th) })
    }
    pts.push({ x: Wr, y: Dm + r })
  } else {
    pts.push({ x: Wr, y: Dm })
  }
  pts.push({ x: Wr, y: R }, { x: 0, y: R })

  const mirrored = s.returnSide === 'right' ? pts.map((p) => ({ x: L - p.x, y: p.y })).reverse() : pts
  const c = { x: L / 2, y: R / 2 }
  return mirrored.map((p) => ({ x: p.x - c.x, y: p.y - c.y }))
}

export function ellipsePolygon(width: number, depth: number): Poly {
  const pts: Vec[] = []
  for (let i = 0; i < ELLIPSE_STEPS; i++) {
    const th = (2 * Math.PI * i) / ELLIPSE_STEPS
    pts.push({ x: (width / 2) * Math.cos(th), y: (depth / 2) * Math.sin(th) })
  }
  return pts
}

/** Unflipped, unrotated footprint relative to the object's origin. */
export function localPolygon(shape: Shape, width: number, depth: number): Poly {
  switch (shape.kind) {
    case 'rect':
      return [
        { x: -width / 2, y: -depth / 2 },
        { x: width / 2, y: -depth / 2 },
        { x: width / 2, y: depth / 2 },
        { x: -width / 2, y: depth / 2 },
      ]
    case 'ellipse':
      return ellipsePolygon(width, depth)
    case 'polygon':
      return shape.vertices
    case 'ldesk':
      return lDeskPolygon(shape)
  }
}

/** Width and depth of the footprint's bounding box (what the inspector shows as W x D). */
export function shapeExtent(shape: Shape, width: number, depth: number): { width: number; depth: number } {
  if (shape.kind === 'rect' || shape.kind === 'ellipse') return { width, depth }
  const b = bbox(localPolygon(shape, width, depth))
  const s = bboxSize(b)
  return { width: s.w, depth: s.h }
}

/** Shift polygon vertices so the origin is the bounding-box centre. */
export function recentrePolygon(vertices: Vec[]): Vec[] {
  const c = bboxCenter(bbox(vertices))
  return vertices.map((p) => ({ x: p.x - c.x, y: p.y - c.y }))
}
