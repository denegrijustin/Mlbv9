import { create } from 'zustand'
import { produce, type Draft } from 'immer'
import { shapeExtent } from '../geometry/shapes'
import { createSeedProject, furnitureFromTemplate, makeArch, makeInteriorWall } from '../model/defaults'
import { newId } from '../model/ids'
import type { ArchItem, ArchType, FurnitureItem, FurnitureTemplate, InteriorWall, Layout, Project, Room, Settings } from '../model/types'
import type { Vec } from '../geometry/vec'

const HISTORY_LIMIT = 200
const COALESCE_MS = 700

interface ProjectState {
  project: Project
  past: Project[]
  future: Project[]
  /** Snapshot taken when a drag/resize/rotate gesture begins, so the whole gesture undoes as one step. */
  base: Project | null
  lastCommit: { key: string; at: number } | null
  hydrated: boolean

  // history
  commit: (recipe: (d: Draft<Project>) => void, coalesceKey?: string) => void
  beginTransient: () => void
  applyTransient: (recipe: (d: Draft<Project>) => void) => void
  endTransient: () => void
  cancelTransient: () => void
  undo: () => void
  redo: () => void

  // project
  loadProject: (p: Project) => void
  resetToSeed: () => void
  renameProject: (name: string) => void
  setSettings: (patch: Partial<Settings>) => void
  setRules: (patch: Partial<Settings['rules']>) => void

  // room + architecture
  updateRoom: (patch: Partial<Pick<Room, 'name' | 'width' | 'depth' | 'ceilingHeight' | 'floor' | 'wallThickness'>>) => void
  swapRoomDimensions: () => void
  addArch: (type: ArchType, over?: Partial<ArchItem>) => string
  updateArch: (id: string, patch: Partial<ArchItem>, transient?: boolean) => void
  removeArch: (id: string) => void
  addInteriorWall: (a: Vec, b: Vec) => string
  updateInteriorWall: (id: string, patch: Partial<InteriorWall>, transient?: boolean) => void
  removeInteriorWall: (id: string) => void

  // furniture (active layout)
  addFurniture: (tpl: FurnitureTemplate, at: Vec) => string
  updateFurniture: (id: string, patch: Partial<FurnitureItem>, transient?: boolean) => void
  removeFurniture: (ids: string[]) => void
  duplicateFurniture: (id: string) => string | null
  mirrorFurniture: (id: string, axis: 'x' | 'y') => void
  rotateFurniture: (id: string, deltaDeg: number) => void

  // templates
  saveTemplate: (tpl: FurnitureTemplate) => void
  removeTemplate: (id: string) => void

  // layouts
  addLayout: (opts?: { duplicate?: boolean; name?: string }) => string
  renameLayout: (id: string, name: string) => void
  deleteLayout: (id: string) => void
  setActiveLayout: (id: string) => void

  // measurements
  addMeasurement: (a: Vec, b: Vec) => void
  removeMeasurement: (id: string) => void
  clearMeasurements: () => void
}

/** Keep width/depth consistent with the footprint for shapes whose size is derived from their geometry. */
export function normalizeFurniture(f: FurnitureItem): FurnitureItem {
  if (f.shape.kind === 'rect' || f.shape.kind === 'ellipse') return f
  const ext = shapeExtent(f.shape, f.width, f.depth)
  return ext.width === f.width && ext.depth === f.depth ? f : { ...f, width: ext.width, depth: ext.depth }
}

const activeLayout = (d: Draft<Project>): Draft<Layout> => d.layouts.find((l) => l.id === d.activeLayoutId) ?? d.layouts[0]

export const useProject = create<ProjectState>((set, get) => {
  const commitRecipe = (recipe: (d: Draft<Project>) => void, coalesceKey?: string) => {
    const { project, past, lastCommit } = get()
    const next = produce(project, recipe)
    if (next === project) return
    const stamped = { ...next, updatedAt: Date.now() }
    const now = Date.now()
    const merge = coalesceKey && lastCommit && lastCommit.key === coalesceKey && now - lastCommit.at < COALESCE_MS && past.length > 0
    set({
      project: stamped,
      past: merge ? past : [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      lastCommit: coalesceKey ? { key: coalesceKey, at: now } : null,
    })
  }

  const patchFurniture = (id: string, patch: Partial<FurnitureItem>, transient: boolean) => {
    const recipe = (d: Draft<Project>) => {
      const f = activeLayout(d).furniture.find((x) => x.id === id)
      if (!f) return
      Object.assign(f, patch)
      const n = normalizeFurniture(f as FurnitureItem)
      f.width = n.width
      f.depth = n.depth
    }
    if (transient) get().applyTransient(recipe)
    else commitRecipe(recipe)
  }

  return {
    project: createSeedProject(),
    past: [],
    future: [],
    base: null,
    lastCommit: null,
    hydrated: false,

    commit: commitRecipe,

    beginTransient: () => {
      if (get().base === null) set({ base: get().project })
    },
    applyTransient: (recipe) => {
      const next = produce(get().project, recipe)
      if (next !== get().project) set({ project: next })
    },
    endTransient: () => {
      const { base, project, past } = get()
      if (base === null) return
      if (project !== base) set({ past: [...past, base].slice(-HISTORY_LIMIT), future: [], base: null, project: { ...project, updatedAt: Date.now() }, lastCommit: null })
      else set({ base: null })
    },
    cancelTransient: () => {
      const { base } = get()
      if (base) set({ project: base, base: null })
    },
    undo: () => {
      const { past, project, future } = get()
      if (past.length === 0) return
      set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], lastCommit: null, base: null })
    },
    redo: () => {
      const { future, project, past } = get()
      if (future.length === 0) return
      set({ project: future[0], future: future.slice(1), past: [...past, project], lastCommit: null, base: null })
    },

    loadProject: (p) => set({ project: p, past: [], future: [], base: null, lastCommit: null, hydrated: true }),
    resetToSeed: () => set({ project: createSeedProject(), past: [], future: [], base: null, lastCommit: null }),
    renameProject: (name) => commitRecipe((d) => void (d.name = name), 'rename-project'),
    // Display preferences are not part of the undo history.
    setSettings: (patch) => set((s) => ({ project: { ...s.project, settings: { ...s.project.settings, ...patch } } })),
    setRules: (patch) => set((s) => ({ project: { ...s.project, settings: { ...s.project.settings, rules: { ...s.project.settings.rules, ...patch } } } })),

    updateRoom: (patch) => commitRecipe((d) => void Object.assign(d.room, patch)),
    swapRoomDimensions: () =>
      commitRecipe((d) => {
        const w = d.room.width
        d.room.width = d.room.depth
        d.room.depth = w
      }),
    addArch: (type, over = {}) => {
      const item = makeArch(type, over)
      commitRecipe((d) => void d.room.items.push(item as Draft<ArchItem>))
      return item.id
    },
    updateArch: (id, patch, transient = false) => {
      const recipe = (d: Draft<Project>) => {
        const it = d.room.items.find((x) => x.id === id)
        if (it) Object.assign(it, patch)
      }
      if (transient) get().applyTransient(recipe)
      else commitRecipe(recipe)
    },
    removeArch: (id) => commitRecipe((d) => void (d.room.items = d.room.items.filter((x) => x.id !== id))),
    addInteriorWall: (a, b) => {
      const w = makeInteriorWall({ a, b })
      commitRecipe((d) => void d.room.interiorWalls.push(w))
      return w.id
    },
    updateInteriorWall: (id, patch, transient = false) => {
      const recipe = (d: Draft<Project>) => {
        const w = d.room.interiorWalls.find((x) => x.id === id)
        if (w) Object.assign(w, patch)
      }
      if (transient) get().applyTransient(recipe)
      else commitRecipe(recipe)
    },
    removeInteriorWall: (id) =>
      commitRecipe((d) => {
        d.room.interiorWalls = d.room.interiorWalls.filter((x) => x.id !== id)
        // Anything attached to the removed wall becomes unplaced again rather than silently moving to another wall.
        for (const it of d.room.items) if ('wallId' in it && it.wallId === id) it.wallId = null
      }),

    addFurniture: (tpl, at) => {
      const item = furnitureFromTemplate(tpl, at)
      commitRecipe((d) => void activeLayout(d).furniture.push(item as Draft<FurnitureItem>))
      return item.id
    },
    updateFurniture: (id, patch, transient = false) => patchFurniture(id, patch, transient),
    removeFurniture: (ids) =>
      commitRecipe((d) => {
        const l = activeLayout(d)
        l.furniture = l.furniture.filter((f) => !ids.includes(f.id))
      }),
    duplicateFurniture: (id) => {
      const src = activeLayout(get().project as Draft<Project>).furniture.find((f) => f.id === id)
      if (!src) return null
      const copy: FurnitureItem = { ...structuredClone(src as FurnitureItem), id: newId('f'), name: `${src.name} copy`, x: src.x + 12, y: src.y + 12, locked: false }
      commitRecipe((d) => void activeLayout(d).furniture.push(copy as Draft<FurnitureItem>))
      return copy.id
    },
    mirrorFurniture: (id, axis) =>
      commitRecipe((d) => {
        const f = activeLayout(d).furniture.find((x) => x.id === id)
        if (!f) return
        if (axis === 'x') f.flipX = !f.flipX
        else f.flipY = !f.flipY
      }),
    rotateFurniture: (id, deltaDeg) =>
      commitRecipe((d) => {
        const f = activeLayout(d).furniture.find((x) => x.id === id)
        if (f) f.rotation = (((f.rotation + deltaDeg) % 360) + 360) % 360
      }),

    saveTemplate: (tpl) =>
      commitRecipe((d) => {
        const i = d.customTemplates.findIndex((t) => t.id === tpl.id)
        if (i >= 0) d.customTemplates[i] = tpl as Draft<FurnitureTemplate>
        else d.customTemplates.push(tpl as Draft<FurnitureTemplate>)
      }),
    removeTemplate: (id) => commitRecipe((d) => void (d.customTemplates = d.customTemplates.filter((t) => t.id !== id))),

    addLayout: (opts = {}) => {
      const p = get().project
      const cur = p.layouts.find((l) => l.id === p.activeLayoutId) ?? p.layouts[0]
      const id = newId('layout')
      const letter = String.fromCharCode(65 + (p.layouts.length % 26))
      const layout: Layout = {
        id,
        name: opts.name ?? `Layout ${letter}`,
        furniture: opts.duplicate ? structuredClone(cur.furniture).map((f) => ({ ...f, id: newId('f') })) : [],
      }
      commitRecipe((d) => {
        d.layouts.push(layout as Draft<Layout>)
        d.activeLayoutId = id
      })
      return id
    },
    renameLayout: (id, name) => commitRecipe((d) => void (d.layouts.find((l) => l.id === id)!.name = name), `rename-${id}`),
    deleteLayout: (id) =>
      commitRecipe((d) => {
        if (d.layouts.length <= 1) return
        const idx = d.layouts.findIndex((l) => l.id === id)
        if (idx < 0) return
        d.layouts.splice(idx, 1)
        if (d.activeLayoutId === id) d.activeLayoutId = d.layouts[Math.max(0, idx - 1)].id
      }),
    // Switching layouts is navigation, not an edit, so it is not part of the undo history.
    setActiveLayout: (id) => set((s) => (s.project.layouts.some((l) => l.id === id) ? { project: { ...s.project, activeLayoutId: id } } : s)),

    addMeasurement: (a, b) => commitRecipe((d) => void d.measurements.push({ id: newId('m'), a, b })),
    removeMeasurement: (id) => commitRecipe((d) => void (d.measurements = d.measurements.filter((m) => m.id !== id))),
    clearMeasurements: () => commitRecipe((d) => void (d.measurements = [])),
  }
})

export const selectActiveLayout = (s: ProjectState): Layout => s.project.layouts.find((l) => l.id === s.project.activeLayoutId) ?? s.project.layouts[0]
