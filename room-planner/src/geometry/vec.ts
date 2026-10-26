/** 2D vector math. Plan coordinates: 1 unit = 1 inch, +x right, +y down (screen-like), rotations clockwise-positive. */
export interface Vec {
  x: number
  y: number
}

export const v = (x: number, y: number): Vec => ({ x, y })
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k })
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x
export const len = (a: Vec): number => Math.hypot(a.x, a.y)
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y)
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
export const norm = (a: Vec): Vec => {
  const l = len(a)
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}
/** Rotate +90 degrees (visually clockwise on screen, since +y is down). */
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x })

export const toRad = (deg: number): number => (deg * Math.PI) / 180
export const toDeg = (rad: number): number => (rad * 180) / Math.PI

export const rotate = (a: Vec, deg: number): Vec => {
  const r = toRad(deg)
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/** Normalise any angle to [0, 360). */
export const wrapDeg = (deg: number): number => ((deg % 360) + 360) % 360

/** Signed shortest difference between two angles, in (-180, 180]. */
export const angleDiff = (a: number, b: number): number => {
  const d = wrapDeg(a - b)
  return d > 180 ? d - 360 : d
}

export const approx = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps

export const roundTo = (n: number, step: number): number => Math.round(n / step) * step
