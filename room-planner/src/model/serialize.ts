import { DEFAULT_SETTINGS } from './defaults'
import type { Layout, Project } from './types'

const FORMAT = 'room-planner-project'

export function exportProject(p: Project): string {
  return JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), project: p }, null, 2)
}

export type ImportResult = { ok: true; project: Project } | { ok: false; error: string }

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const isObj = (o: unknown): o is Record<string, unknown> => typeof o === 'object' && o !== null && !Array.isArray(o)

function checkFurniture(f: unknown, where: string): string | null {
  if (!isObj(f)) return `${where} is not an object`
  for (const k of ['x', 'y', 'rotation', 'width', 'depth', 'height'] as const) if (!isNum(f[k])) return `${where}.${k} is not a number`
  if ((f.width as number) <= 0 || (f.depth as number) <= 0) return `${where} has a non-positive size`
  if (typeof f.id !== 'string') return `${where}.id is missing`
  if (!isObj(f.shape) || typeof f.shape.kind !== 'string') return `${where}.shape is missing`
  return null
}

/**
 * Validate and normalise an unknown value into a Project. Missing optional settings are filled from defaults;
 * structural problems are reported (never silently repaired) so a bad file cannot corrupt the scene.
 */
export function validateProject(raw: unknown): ImportResult {
  const candidate = isObj(raw) && isObj(raw.project) && raw.format === FORMAT ? raw.project : raw
  if (!isObj(candidate)) return { ok: false, error: 'This file is not a project.' }
  if (candidate.schema !== 1) return { ok: false, error: `Unsupported project version (${String(candidate.schema)}).` }
  const room = candidate.room
  if (!isObj(room)) return { ok: false, error: 'The project has no room.' }
  for (const k of ['width', 'depth'] as const) {
    if (room[k] !== null && !isNum(room[k])) return { ok: false, error: `Room ${k} must be a number or empty.` }
  }
  if (room.outline !== undefined && room.outline !== null) {
    const o = room.outline
    if (!Array.isArray(o) || o.length < 3 || !o.every((p) => isObj(p) && isNum(p.x) && isNum(p.y))) return { ok: false, error: 'The room outline must be a list of at least 3 corners.' }
  }
  const ref = candidate.reference
  if (ref !== undefined && ref !== null) {
    const nums = ['naturalWidth', 'naturalHeight', 'x', 'y', 'inchesPerPixel', 'rotation', 'opacity'] as const
    if (!isObj(ref) || typeof ref.dataUrl !== 'string' || !/^data:image\//.test(ref.dataUrl) || !nums.every((k) => isNum(ref[k])) || (ref.inchesPerPixel as number) <= 0) {
      return { ok: false, error: 'The reference photo in this file is malformed.' }
    }
  }
  if (!Array.isArray(room.items) || !Array.isArray(room.interiorWalls)) return { ok: false, error: 'The room is missing its architecture lists.' }
  if (!Array.isArray(candidate.layouts) || candidate.layouts.length === 0) return { ok: false, error: 'The project has no layouts.' }
  for (const [i, l] of candidate.layouts.entries()) {
    if (!isObj(l) || typeof l.id !== 'string' || !Array.isArray(l.furniture)) return { ok: false, error: `Layout ${i + 1} is malformed.` }
    for (const [j, f] of l.furniture.entries()) {
      const err = checkFurniture(f, `Layout ${i + 1} furniture ${j + 1}`)
      if (err) return { ok: false, error: err }
    }
  }
  const layouts = candidate.layouts as unknown as Layout[]
  const active = typeof candidate.activeLayoutId === 'string' && layouts.some((l) => l.id === candidate.activeLayoutId) ? (candidate.activeLayoutId as string) : layouts[0].id
  const settings = { ...DEFAULT_SETTINGS, ...(isObj(candidate.settings) ? candidate.settings : {}) }
  settings.rules = { ...DEFAULT_SETTINGS.rules, ...(isObj(settings.rules) ? settings.rules : {}) }
  const project: Project = {
    ...(candidate as unknown as Project),
    activeLayoutId: active,
    settings,
    customTemplates: Array.isArray(candidate.customTemplates) ? (candidate.customTemplates as Project['customTemplates']) : [],
    measurements: Array.isArray(candidate.measurements) ? (candidate.measurements as Project['measurements']) : [],
    updatedAt: isNum(candidate.updatedAt) ? candidate.updatedAt : Date.now(),
  }
  return { ok: true, project }
}

export function importProject(text: string): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' }
  }
  return validateProject(raw)
}
