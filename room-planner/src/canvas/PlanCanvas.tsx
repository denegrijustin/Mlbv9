import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyseFurniture, collisionMap } from '../engine/analysis'
import { constrainMove, findCollisions } from '../engine/collisions'
import { resolveArchitecture, type ResolvedArch } from '../engine/room'
import { buildObstacles, furniturePolygon, type Obstacle } from '../engine/scene'
import { snapAngle, snapMove, type Guide, type SnapOptions, type SnapTarget } from '../engine/snapping'
import { bbox, rotatedRect, transformPoly, unionBBox, type BBox } from '../geometry/polygon'
import { localPolygon } from '../geometry/shapes'
import { add, dist, dot, norm, rotate, sub, toDeg, type Vec } from '../geometry/vec'
import { lengthFormatter } from '../lib/format'
import { allTemplates } from '../model/library'
import type { BuiltIn, FurnitureItem, Pillar, RectArch } from '../model/types'
import { selectActiveLayout, useProject } from '../store/project'
import { useUi, type Viewport } from '../store/ui'
import { PlanScene, Chip } from './PlanScene'
import { useTheme } from './theme'
import { centerBBox, fitBBox, toScreen, toWorld, zoomAt } from './view'

const DRAG_THRESHOLD = 4 // px before a press becomes a drag
const SNAP_PICK_PX = 9
const r4 = (n: number) => Math.round(n * 10000) / 10000
const r8 = (n: number) => Math.round(n * 8) / 8

type Gesture =
  | { kind: 'pan'; start: Vec; vp0: Viewport; moved: boolean; tap: 'deselect' | 'measure' | 'wall' }
  | { kind: 'furniture'; id: string; startPx: Vec; startWorld: Vec; startPos: Vec; last: Vec; began: boolean; obstacles: Obstacle[]; targets: SnapTarget[] }
  | { kind: 'rotate'; id: string; last: number; began: boolean; obstacles: Obstacle[] }
  | { kind: 'resize'; id: string; target: 'furniture' | 'arch'; sx: number; sy: number; began: boolean }
  | { kind: 'arch'; id: string; startPx: Vec; startWorld: Vec; startXY: Vec; began: boolean; targets: SnapTarget[] }
  | { kind: 'opening'; id: string; startPx: Vec; grab: number; wallId: string; began: boolean }
  | { kind: 'wall'; id: string; startPx: Vec; startWorld: Vec; a0: Vec; b0: Vec; began: boolean }
  | { kind: 'wallpoint'; id: string; end: 'a' | 'b'; began: boolean }
  | { kind: 'pinch' }

export function PlanCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 900, h: 640 })
  const [measured, setMeasured] = useState(false)
  const [hoverB, setHoverB] = useState<Vec | null>(null)
  const [rotLabel, setRotLabel] = useState<number | null>(null)
  const theme = useTheme()

  const project = useProject((s) => s.project)
  const layout = useProject(selectActiveLayout)
  const hydrated = useProject((s) => s.hydrated)
  const { settings } = project

  const vp = useUi((s) => s.viewport)
  const mode = useUi((s) => s.mode)
  const selection = useUi((s) => s.selection)
  const drag = useUi((s) => s.drag)
  const presentation = useUi((s) => s.presentation)
  const ghostId = useUi((s) => s.ghostLayoutId)
  const measureDraft = useUi((s) => s.measureDraft)
  const wallDraft = useUi((s) => s.wallDraft)
  const wallTool = useUi((s) => s.wallTool)
  const cmd = useUi((s) => s.canvasCmd)
  const fmt = useMemo(() => lengthFormatter(settings), [settings])

  const arch = useMemo(() => resolveArchitecture(project.room), [project.room])
  const furniture = layout.furniture
  const ctx = useMemo(() => ({ arch, furniture, settings: { rules: settings.rules } }), [arch, furniture, settings.rules])
  const collisions = useMemo(() => collisionMap(ctx), [ctx])
  const selFurniture = selection?.kind === 'furniture' ? furniture.find((f) => f.id === selection.id) ?? null : null
  const analysis = useMemo(() => (selFurniture && !selFurniture.hidden ? analyseFurniture(selFurniture, ctx) : null), [selFurniture, ctx])
  const ghost = useMemo(() => {
    if (!ghostId || ghostId === layout.id) return []
    return project.layouts.find((l) => l.id === ghostId)?.furniture.filter((f) => !f.hidden) ?? []
  }, [ghostId, layout.id, project.layouts])

  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, Vec>())
  const pinch = useRef<{ d0: number; vp0: Viewport; mid0: Vec } | null>(null)
  const spaceDown = useRef(false)
  const vpRef = useRef(vp)
  vpRef.current = vp
  const fitted = useRef(false)

  // ---------------------------------------------------------------- sizing + fit
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = () => {
      const next = { w: Math.max(200, el.clientWidth), h: Math.max(200, el.clientHeight) }
      setSize(next)
      setMeasured(true)
      useUi.getState().setCanvasSize(next)
    }
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    apply()
    return () => ro.disconnect()
  }, [])

  const sceneBox = useCallback((): BBox => {
    const rr = arch.room
    const fb = unionBBox(furniture.filter((f) => !f.hidden).map((f) => bbox(furniturePolygon(f))))
    const w = rr.width ?? Math.max(120, (fb?.maxX ?? 0) + 24)
    const d = rr.depth ?? Math.max(96, (fb?.maxY ?? 0) + 24)
    const pad = project.room.wallThickness + 18
    const room: BBox = { minX: -pad, minY: -pad, maxX: w + pad, maxY: d + pad }
    return fb ? unionBBox([room, fb])! : room
  }, [arch, furniture, project.room.wallThickness])

  useEffect(() => {
    if (!hydrated || fitted.current || !measured) return
    fitted.current = true
    useUi.getState().setViewport(fitBBox(sceneBox(), size, 70))
  }, [hydrated, measured, size, sceneBox])

  useEffect(() => {
    if (!cmd) return
    const set = useUi.getState().setViewport
    const cur = vpRef.current
    const mid = { x: size.w / 2, y: size.h / 2 }
    if (cmd.type === 'fit' || cmd.type === 'reset') set(fitBBox(sceneBox(), size, 70))
    else if (cmd.type === 'center') set(centerBBox(cur, sceneBox(), size))
    else set(zoomAt(cur, cmd.type === 'zoomIn' ? 1.25 : 1 / 1.25, mid))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd?.nonce])

  // ---------------------------------------------------------------- keyboard: space = pan
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) {
        spaceDown.current = true
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // ---------------------------------------------------------------- wheel zoom (native listener so we can preventDefault)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const k = e.ctrlKey ? 0.012 : 0.0016
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      useUi.getState().setViewport(zoomAt(vpRef.current, Math.exp(-delta * k), anchor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---------------------------------------------------------------- helpers
  const screenPt = (e: { clientX: number; clientY: number }): Vec => {
    const r = wrapRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const worldPt = (e: { clientX: number; clientY: number }): Vec => toWorld(vpRef.current, screenPt(e))

  const snapOptions = (e: { altKey: boolean }): SnapOptions => {
    const s = useProject.getState().project.settings
    return {
      enabled: s.snapEnabled && !e.altKey && !useUi.getState().snapSuspended,
      walls: s.snapWalls,
      edges: s.snapEdges,
      centers: s.snapCenters,
      grid: s.snapGrid ? s.gridSize : 0,
      threshold: s.snapThreshold,
    }
  }

  const currentArch = () => resolveArchitecture(useProject.getState().project.room)
  const currentFurniture = (id: string): FurnitureItem | undefined => selectActiveLayout(useProject.getState()).furniture.find((f) => f.id === id)

  const snapTargetsFor = (exceptId: string): SnapTarget[] => {
    const a = currentArch()
    const out: SnapTarget[] = []
    for (const f of selectActiveLayout(useProject.getState()).furniture) {
      if (f.id === exceptId || f.hidden || !f.collides) continue
      out.push({ id: f.id, box: bbox(furniturePolygon(f)) })
    }
    for (const r of a.arch) if (r.placed && r.polygon && r.type !== 'tv' && r.id !== exceptId) out.push({ id: r.id, box: bbox(r.polygon) })
    for (const w of a.room.walls) if (w.kind === 'interior' && w.id !== exceptId) out.push({ id: w.id, box: bbox(obstacleWall(w)) })
    return out
  }
  const obstacleWall = (w: { a: Vec; b: Vec; thickness: number }) => {
    const d = norm(sub(w.b, w.a))
    const n = { x: -d.y * (w.thickness / 2), y: d.x * (w.thickness / 2) }
    return [add(w.a, n), add(w.b, n), sub(w.b, n), sub(w.a, n)]
  }

  /** Snap a free point (measure / wall tool) to nearby corners and vertices. */
  const snapPoint = (p: Vec, alt: boolean): Vec => {
    if (alt) return { x: r8(p.x), y: r8(p.y) }
    const a = currentArch()
    const cands: Vec[] = []
    const rr = a.room
    const W = rr.width
    const D = rr.depth
    cands.push({ x: 0, y: 0 })
    if (W !== null) cands.push({ x: W, y: 0 })
    if (D !== null) cands.push({ x: 0, y: D })
    if (W !== null && D !== null) cands.push({ x: W, y: D })
    for (const w of rr.walls) {
      cands.push(w.a, w.b)
    }
    for (const r of a.arch) {
      if (r.polygon) cands.push(...r.polygon)
      if (r.segment) cands.push(r.segment.a, r.segment.b)
    }
    for (const f of selectActiveLayout(useProject.getState()).furniture) if (!f.hidden) cands.push(...furniturePolygon(f))
    const maxD = SNAP_PICK_PX / vpRef.current.zoom
    let best: Vec | null = null
    let bestD = maxD
    for (const c of cands) {
      if (Math.abs(c.x) > 5000 || Math.abs(c.y) > 5000) continue
      const d = dist(c, p)
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    return best ?? { x: r8(p.x), y: r8(p.y) }
  }

  const constrainMeasure = (a: Vec, b: Vec): Vec => {
    const m = useUi.getState().measureMode
    return m === 'horizontal' ? { x: b.x, y: a.y } : m === 'vertical' ? { x: a.x, y: b.y } : b
  }

  /** Orthogonal / edge snapping for wall endpoints. */
  const snapWallPoint = (p: Vec, from: Vec | null, alt: boolean): Vec => {
    let q = { x: r8(p.x), y: r8(p.y) }
    if (alt) return q
    const a = currentArch().room
    const th = useProject.getState().project.settings.snapThreshold
    if (from) {
      const dx = q.x - from.x
      const dy = q.y - from.y
      const ang = Math.abs(toDeg(Math.atan2(dy, dx)))
      if (Math.abs(dy) < 1e-9 || ang < 3 || ang > 177) q = { x: q.x, y: from.y }
      else if (Math.abs(ang - 90) < 3) q = { x: from.x, y: q.y }
    }
    if (Math.abs(q.x) <= th) q = { x: 0, y: q.y }
    if (Math.abs(q.y) <= th) q = { x: q.x, y: 0 }
    if (a.width !== null && Math.abs(q.x - a.width) <= th) q = { x: a.width, y: q.y }
    if (a.depth !== null && Math.abs(q.y - a.depth) <= th) q = { x: q.x, y: a.depth }
    return q
  }

  // ---------------------------------------------------------------- pointer handling
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const sp = screenPt(e)
    pointers.current.set(e.pointerId, sp)
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    const ui = useUi.getState()
    const proj = useProject.getState()

    if (pointers.current.size === 2) {
      proj.cancelTransient()
      gesture.current = { kind: 'pinch' }
      const [p1, p2] = [...pointers.current.values()]
      pinch.current = { d0: Math.max(1, dist(p1, p2)), vp0: vpRef.current, mid0: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } }
      ui.setDrag(null)
      return
    }

    const target = (e.target as Element).closest('[data-hit]') as HTMLElement | null
    const hit = target?.dataset.hit
    const id = target?.dataset.id ?? ''
    const world = toWorld(vpRef.current, sp)

    if (spaceDown.current || e.button === 1) {
      gesture.current = { kind: 'pan', start: sp, vp0: vpRef.current, moved: false, tap: 'deselect' }
      return
    }

    // tools that act on taps over empty canvas AND over objects
    if (ui.mode === 'measure') {
      gesture.current = { kind: 'pan', start: sp, vp0: vpRef.current, moved: false, tap: 'measure' }
      return
    }
    if (ui.mode === 'room' && ui.wallTool) {
      gesture.current = { kind: 'pan', start: sp, vp0: vpRef.current, moved: false, tap: 'wall' }
      return
    }

    if (hit === 'rotate') {
      const f = currentFurniture(id)
      if (f && !f.locked) {
        gesture.current = { kind: 'rotate', id, last: f.rotation, began: false, obstacles: buildObstacles(currentArch(), selectActiveLayout(proj).furniture, proj.project.settings, { exceptId: id }) }
        return
      }
    }
    if (hit === 'resize') {
      const [sx, sy] = (target?.dataset.handle ?? '0,0').split(',').map(Number)
      gesture.current = { kind: 'resize', id, target: (target?.dataset.target as 'furniture' | 'arch') ?? 'furniture', sx, sy, began: false }
      return
    }
    if (hit === 'wallpoint') {
      gesture.current = { kind: 'wallpoint', id, end: (target?.dataset.end as 'a' | 'b') ?? 'b', began: false }
      return
    }

    if (hit === 'furniture' && ui.mode === 'furniture') {
      ui.select({ kind: 'furniture', id })
      const f = currentFurniture(id)
      if (f && !f.locked) {
        const a = currentArch()
        gesture.current = {
          kind: 'furniture', id, startPx: sp, startWorld: world, startPos: { x: f.x, y: f.y }, last: { x: f.x, y: f.y }, began: false,
          obstacles: buildObstacles(a, selectActiveLayout(proj).furniture, proj.project.settings, { exceptId: id }),
          targets: snapTargetsFor(id),
        }
      } else {
        gesture.current = { kind: 'pan', start: sp, vp0: vpRef.current, moved: false, tap: 'deselect' }
      }
      return
    }
    if (hit === 'arch') {
      ui.select({ kind: 'arch', id })
      const item = proj.project.room.items.find((i) => i.id === id)
      if (item && ui.mode === 'room' && !item.locked) {
        if (item.type === 'pillar' || item.type === 'builtin') {
          const r = item as RectArch
          if (r.x !== null && r.y !== null) {
            gesture.current = { kind: 'arch', id, startPx: sp, startWorld: world, startXY: { x: r.x, y: r.y }, began: false, targets: snapTargetsFor(id) }
            return
          }
        } else if ('wallId' in item && item.wallId && item.offset !== null) {
          const a = currentArch()
          const wall = a.room.wallById.get(item.wallId)
          if (wall) {
            gesture.current = { kind: 'opening', id, startPx: sp, grab: dot(sub(world, wall.a), wall.dir) - item.offset, wallId: wall.id, began: false }
            return
          }
        }
      }
      gesture.current = { kind: 'pan', start: sp, vp0: vpRef.current, moved: false, tap: 'deselect' }
      return
    }
    if (hit === 'wall' && ui.mode === 'room') {
      ui.select({ kind: 'wall', id })
      const w = proj.project.room.interiorWalls.find((x) => x.id === id)
      if (w && !w.locked) {
        gesture.current = { kind: 'wall', id, startPx: sp, startWorld: world, a0: w.a, b0: w.b, began: false }
        return
      }
      gesture.current = { kind: 'pan', start: sp, vp0: vpRef.current, moved: false, tap: 'deselect' }
      return
    }

    gesture.current = { kind: 'pan', start: sp, vp0: vpRef.current, moved: false, tap: 'deselect' }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const sp = screenPt(e)
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, sp)
    const g = gesture.current
    const ui = useUi.getState()
    const proj = useProject.getState()

    // hover preview for tools
    if (!g) {
      if (ui.mode === 'measure' && ui.measureDraft) {
        const p = snapPoint(toWorld(vpRef.current, sp), e.altKey)
        setHoverB(constrainMeasure(ui.measureDraft, p))
      } else if (ui.mode === 'room' && ui.wallTool && ui.wallDraft) {
        setHoverB(snapWallPoint(toWorld(vpRef.current, sp), ui.wallDraft, e.altKey))
      }
      return
    }

    if (g.kind === 'pinch') {
      if (pointers.current.size >= 2 && pinch.current) {
        const [p1, p2] = [...pointers.current.values()]
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
        const k = dist(p1, p2) / pinch.current.d0
        const v0 = pinch.current.vp0
        const zoomed = zoomAt(v0, k, pinch.current.mid0)
        ui.setViewport({ zoom: zoomed.zoom, panX: zoomed.panX + (mid.x - pinch.current.mid0.x), panY: zoomed.panY + (mid.y - pinch.current.mid0.y) })
      }
      return
    }

    if (g.kind === 'pan') {
      const dx = sp.x - g.start.x
      const dy = sp.y - g.start.y
      if (!g.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) g.moved = true
      if (g.moved) {
        ui.setViewport({ panX: g.vp0.panX + dx, panY: g.vp0.panY + dy })
        return
      }
      if (g.tap === 'measure' && ui.measureDraft) {
        const p = snapPoint(toWorld(vpRef.current, sp), e.altKey)
        setHoverB(constrainMeasure(ui.measureDraft, p))
      }
      return
    }

    const world = toWorld(vpRef.current, sp)
    const settings = proj.project.settings
    const arch0 = currentArch()

    if (g.kind === 'furniture') {
      if (!g.began) {
        if (Math.hypot(sp.x - g.startPx.x, sp.y - g.startPx.y) < DRAG_THRESHOLD) return
        g.began = true
        proj.beginTransient()
      }
      const item = currentFurniture(g.id)
      if (!item) return
      const raw = { x: g.startPos.x + (world.x - g.startWorld.x), y: g.startPos.y + (world.y - g.startWorld.y) }
      const box = bbox(furniturePolygon(item, raw))
      const snap = snapMove(box, arch0.room, g.targets, snapOptions(e))
      let pos = { x: raw.x + snap.dx, y: raw.y + snap.dy }
      if (settings.collisionMode === 'prevent' && item.collides) {
        const collidesAt = (p: Vec) => findCollisions(furniturePolygon(item, p), g.obstacles, arch0.room.polygon).length > 0
        pos = constrainMove(pos, g.last, collidesAt)
        if (pos.x !== raw.x + snap.dx || pos.y !== raw.y + snap.dy) snap.guides.length = 0
      }
      pos = { x: r4(pos.x), y: r4(pos.y) }
      g.last = pos
      proj.updateFurniture(g.id, { x: pos.x, y: pos.y }, true)
      ui.setDrag({ id: g.id, guides: snap.guides as Guide[], collisions: [] })
      return
    }

    if (g.kind === 'rotate') {
      const item = currentFurniture(g.id)
      if (!item) return
      if (!g.began) {
        g.began = true
        proj.beginTransient()
        ui.setDrag({ id: g.id, guides: [], collisions: [] })
      }
      const ang = toDeg(Math.atan2(world.y - item.y, world.x - item.x)) + 90
      const snapped = snapAngle(ang, settings.rotationSnap, !e.altKey)
      let rot = snapped
      if (settings.collisionMode === 'prevent' && item.collides) {
        if (findCollisions(furniturePolygon(item, { rotation: rot }), g.obstacles, arch0.room.polygon).length > 0) rot = g.last
      }
      g.last = rot
      setRotLabel(rot)
      proj.updateFurniture(g.id, { rotation: rot }, true)
      return
    }

    if (g.kind === 'resize') {
      if (!g.began) {
        g.began = true
        proj.beginTransient()
        ui.setDrag({ id: g.id, guides: [], collisions: [] })
      }
      if (g.target === 'furniture') {
        const item = currentFurniture(g.id)
        if (!item) return
        const local = rotate(sub(world, { x: item.x, y: item.y }), -item.rotation)
        const next = resizeBox({ cx: item.x, cy: item.y, w: item.width, d: item.depth, rot: item.rotation }, g.sx, g.sy, local, e.altKey)
        proj.updateFurniture(g.id, { x: r4(next.cx), y: r4(next.cy), width: next.w, depth: next.d }, true)
      } else {
        const it = proj.project.room.items.find((i) => i.id === g.id) as RectArch | undefined
        if (!it || it.x === null || it.y === null || it.width === null || it.depth === null) return
        const c = { x: it.x + it.width / 2, y: it.y + it.depth / 2 }
        const local = rotate(sub(world, c), -it.rotation)
        const next = resizeBox({ cx: c.x, cy: c.y, w: it.width, d: it.depth, rot: it.rotation }, g.sx, g.sy, local, e.altKey)
        proj.updateArch(g.id, { x: r4(next.cx - next.w / 2), y: r4(next.cy - next.d / 2), width: next.w, depth: next.d } as Partial<RectArch>, true)
      }
      return
    }

    if (g.kind === 'arch') {
      if (!g.began) {
        if (Math.hypot(sp.x - g.startPx.x, sp.y - g.startPx.y) < DRAG_THRESHOLD) return
        g.began = true
        proj.beginTransient()
      }
      const it = proj.project.room.items.find((i) => i.id === g.id) as RectArch | undefined
      if (!it || it.width === null || it.depth === null) return
      const raw = { x: g.startXY.x + (world.x - g.startWorld.x), y: g.startXY.y + (world.y - g.startWorld.y) }
      const box = bbox(rotatedRect(raw.x + it.width / 2, raw.y + it.depth / 2, it.width, it.depth, it.rotation))
      const snap = snapMove(box, arch0.room, g.targets, snapOptions(e))
      proj.updateArch(g.id, { x: r4(raw.x + snap.dx), y: r4(raw.y + snap.dy) } as Partial<RectArch>, true)
      ui.setDrag({ id: g.id, guides: snap.guides as Guide[], collisions: [] })
      return
    }

    if (g.kind === 'opening') {
      if (!g.began) {
        if (Math.hypot(sp.x - g.startPx.x, sp.y - g.startPx.y) < DRAG_THRESHOLD) return
        g.began = true
        proj.beginTransient()
      }
      const it = proj.project.room.items.find((i) => i.id === g.id)
      if (!it || !('wallId' in it) || it.width === null) return
      // nearest wall to the pointer
      let best: { wall: (typeof arch0.room.walls)[number]; d: number } | null = null
      for (const w of arch0.room.walls) {
        const t = Math.max(0, Math.min(1, dot(sub(world, w.a), sub(w.b, w.a)) / Math.max(1e-9, dot(sub(w.b, w.a), sub(w.b, w.a)))))
        const q = add(w.a, { x: (w.b.x - w.a.x) * t, y: (w.b.y - w.a.y) * t })
        const d = dist(q, world)
        if (!best || d < best.d) best = { wall: w, d }
      }
      if (!best || best.d > 40) return
      let wall = best.wall
      let grab = g.grab
      if (wall.id !== g.wallId) {
        grab = it.width / 2
        g.wallId = wall.id
        g.grab = grab
      } else wall = arch0.room.wallById.get(g.wallId) ?? wall
      let offset = dot(sub(world, wall.a), wall.dir) - grab
      if (wall.length !== null) offset = Math.min(offset, wall.length - it.width)
      offset = Math.max(0, r8(offset))
      proj.updateArch(g.id, { wallId: wall.id, offset } as never, true)
      return
    }

    if (g.kind === 'wall') {
      if (!g.began) {
        if (Math.hypot(sp.x - g.startPx.x, sp.y - g.startPx.y) < DRAG_THRESHOLD) return
        g.began = true
        proj.beginTransient()
      }
      const dx = r8(world.x - g.startWorld.x)
      const dy = r8(world.y - g.startWorld.y)
      proj.updateInteriorWall(g.id, { a: { x: g.a0.x + dx, y: g.a0.y + dy }, b: { x: g.b0.x + dx, y: g.b0.y + dy } }, true)
      return
    }

    if (g.kind === 'wallpoint') {
      if (!g.began) {
        g.began = true
        proj.beginTransient()
      }
      const w = proj.project.room.interiorWalls.find((x) => x.id === g.id)
      if (!w) return
      const other = g.end === 'a' ? w.b : w.a
      const p = snapWallPoint(world, other, e.altKey)
      proj.updateInteriorWall(g.id, g.end === 'a' ? { a: p } : { b: p }, true)
    }
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    pointers.current.delete(e.pointerId)
    const ui = useUi.getState()
    const proj = useProject.getState()
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)

    if (g?.kind === 'pinch') {
      if (pointers.current.size < 2) {
        gesture.current = null
        pinch.current = null
      }
      return
    }
    gesture.current = null
    setRotLabel(null)
    if (!g) return

    if (g.kind === 'pan' && !g.moved) {
      const sp = screenPt(e)
      const w = toWorld(vpRef.current, sp)
      if (g.tap === 'measure') {
        const p = snapPoint(w, e.altKey)
        if (!ui.measureDraft) ui.setMeasureDraft(p)
        else {
          proj.addMeasurement(ui.measureDraft, constrainMeasure(ui.measureDraft, p))
          ui.setMeasureDraft(null)
          setHoverB(null)
        }
      } else if (g.tap === 'wall') {
        const p = snapWallPoint(w, ui.wallDraft, e.altKey)
        if (!ui.wallDraft) ui.setWallDraft(p)
        else if (dist(ui.wallDraft, p) >= 1) {
          const id = proj.addInteriorWall(ui.wallDraft, p)
          ui.setWallDraft(p) // chain the next wall from here; Esc or double-click ends
          ui.select({ kind: 'wall', id })
        }
      } else {
        ui.select(null)
      }
    }
    if (g.kind === 'furniture' || g.kind === 'rotate' || g.kind === 'resize' || g.kind === 'arch' || g.kind === 'opening' || g.kind === 'wall' || g.kind === 'wallpoint') {
      if ('began' in g && g.began) proj.endTransient()
    }
    ui.setDrag(null)
  }

  const onDoubleClick = () => {
    const ui = useUi.getState()
    if (ui.wallTool) {
      ui.setWallDraft(null)
      setHoverB(null)
    }
  }

  // drag & drop from the furniture library
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const tid = e.dataTransfer.getData('application/x-room-template')
    if (!tid) return
    const proj = useProject.getState()
    const tpl = allTemplates(proj.project.customTemplates).find((t) => t.id === tid)
    if (!tpl) return
    const id = proj.addFurniture(tpl, worldPt(e))
    useUi.getState().select({ kind: 'furniture', id })
  }

  // ---------------------------------------------------------------- handles + HUD (screen space)
  const handles = useMemo(() => {
    if (presentation || !selection) return null
    const px = vp.zoom
    const out: React.ReactNode[] = []
    if (selection.kind === 'furniture' && selFurniture && !selFurniture.hidden && mode === 'furniture') {
      const f = selFurniture
      const flipped = localPolygon(f.shape, f.width, f.depth).map((p) => ({ x: f.flipX ? -p.x : p.x, y: f.flipY ? -p.y : p.y }))
      const top = Math.min(...flipped.map((p) => p.y))
      const b = bbox(furniturePolygon(f))
      const to = (lx: number, ly: number): Vec => toScreen(vp, transformPoly([{ x: lx, y: ly }], { x: f.x, y: f.y, rotation: f.rotation })[0])
      const edgeTop = to(0, top)
      const handle = to(0, top - 30 / px)
      if (!f.locked) {
        out.push(
          <g key="rot">
            <line x1={edgeTop.x} y1={edgeTop.y} x2={handle.x} y2={handle.y} stroke={theme.accent} strokeWidth={1.5} />
            <g data-hit="rotate" data-id={f.id} style={{ pointerEvents: 'auto', cursor: 'grab' }}>
              <circle cx={handle.x} cy={handle.y} r={14} fill="transparent" />
              <circle cx={handle.x} cy={handle.y} r={9} fill={theme.chip} stroke={theme.accent} strokeWidth={2} />
              <path d={`M ${handle.x - 3.6} ${handle.y + 0.5} a 3.8 3.8 0 1 1 1.2 2.8`} fill="none" stroke={theme.accent} strokeWidth={1.6} strokeLinecap="round" />
              <path d={`M ${handle.x - 5.6} ${handle.y - 0.8} l 2 2.2 l 2 -2.2`} fill="none" stroke={theme.accent} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
            </g>
            {rotLabel !== null && <Chip x={handle.x} y={handle.y - 22} text={`${Math.round(rotLabel * 10) / 10}°`} fg="#fff" bg={theme.accent} bold />}
          </g>,
        )
        if (f.shape.kind === 'rect' || f.shape.kind === 'ellipse') {
          for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) {
            if (sx === 0 && sy === 0) continue
            const p = to((sx * f.width) / 2, (sy * f.depth) / 2)
            const corner = sx !== 0 && sy !== 0
            out.push(
              <g key={`rs-${sx}-${sy}`} data-hit="resize" data-target="furniture" data-id={f.id} data-handle={`${sx},${sy}`} style={{ pointerEvents: 'auto', cursor: 'nwse-resize' }}>
                <circle cx={p.x} cy={p.y} r={11} fill="transparent" />
                <rect x={p.x - (corner ? 4.5 : 3.5)} y={p.y - (corner ? 4.5 : 3.5)} width={corner ? 9 : 7} height={corner ? 9 : 7} rx={2} fill={theme.chip} stroke={theme.accent} strokeWidth={1.75} />
              </g>,
            )
          }
        }
      } else {
        const c = toScreen(vp, { x: f.x, y: f.y })
        out.push(<text key="lock" x={c.x} y={c.y - 20} textAnchor="middle" fontSize={11} fill={theme.ink2}>🔒 locked</text>)
      }
      // coordinates + size HUD
      const dragging = drag?.id === f.id
      const topCenter = toScreen(vp, { x: (b.minX + b.maxX) / 2, y: b.minY })
      const sizeText = f.shape.kind === 'rect' || f.shape.kind === 'ellipse' ? `${fmt(f.width)} × ${fmt(f.depth)}` : `${fmt(f.width)} × ${fmt(f.depth)} overall`
      const text = `X ${fmt(b.minX)}   Y ${fmt(b.minY)}   ·   ${sizeText}   ·   ${Math.round(f.rotation * 10) / 10}°`
      const hudY = Math.max(24, topCenter.y - (f.locked ? 30 : 62))
      if (dragging) out.push(<Chip key="hud" x={topCenter.x} y={hudY} text={text} fg={theme.chipInk} bg={theme.chip} border={theme.ink3} />)
    }
    if (selection.kind === 'arch') {
      const it = project.room.items.find((i) => i.id === selection.id) as Pillar | BuiltIn | RectArch | undefined
      const ra = arch.arch.find((a) => a.id === selection.id) as ResolvedArch | undefined
      if (it && ra?.polygon && 'type' in it && (it.type === 'pillar' || it.type === 'builtin') && mode === 'room' && !it.locked && it.width !== null && it.depth !== null && it.x !== null && it.y !== null) {
        const c = { x: it.x + it.width / 2, y: it.y + it.depth / 2 }
        for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) {
          if (sx === 0 && sy === 0) continue
          const p = toScreen(vp, transformPoly([{ x: (sx * it.width!) / 2, y: (sy * it.depth!) / 2 }], { x: c.x, y: c.y, rotation: it.rotation })[0])
          out.push(
            <g key={`ar-${sx}-${sy}`} data-hit="resize" data-target="arch" data-id={it.id} data-handle={`${sx},${sy}`} style={{ pointerEvents: 'auto', cursor: 'nwse-resize' }}>
              <circle cx={p.x} cy={p.y} r={11} fill="transparent" />
              <rect x={p.x - 4} y={p.y - 4} width={8} height={8} rx={2} fill={theme.chip} stroke={theme.accent} strokeWidth={1.75} />
            </g>,
          )
        }
      }
      if (ra?.polygon) {
        const b = bbox(ra.polygon)
        const t = toScreen(vp, { x: (b.minX + b.maxX) / 2, y: b.minY })
        const text = it && it.x !== null && it.y !== null ? `From west wall ${fmt(it.x)}   From north wall ${fmt(it.y)}` : ''
        if (text && drag?.id === it?.id) out.push(<Chip key="ahud" x={t.x} y={Math.max(24, t.y - 22)} text={text} fg={theme.chipInk} bg={theme.chip} border={theme.ink3} />)
      }
    }
    if (selection.kind === 'wall') {
      const w = project.room.interiorWalls.find((x) => x.id === selection.id)
      if (w && mode === 'room' && !w.locked) {
        for (const end of ['a', 'b'] as const) {
          const p = toScreen(vp, w[end])
          out.push(
            <g key={`wp-${end}`} data-hit="wallpoint" data-id={w.id} data-end={end} style={{ pointerEvents: 'auto', cursor: 'move' }}>
              <circle cx={p.x} cy={p.y} r={12} fill="transparent" />
              <circle cx={p.x} cy={p.y} r={6} fill={theme.chip} stroke={theme.accent} strokeWidth={2} />
            </g>,
          )
        }
      }
    }
    return out
  }, [presentation, selection, selFurniture, mode, vp, theme, fmt, rotLabel, project.room, arch.arch, drag])

  const measureDraftLine = measureDraft && hoverB ? { a: measureDraft, b: hoverB } : null
  const wallDraftLine = wallDraft && hoverB ? { a: wallDraft, b: hoverB } : null

  const cursor = mode === 'measure' || (mode === 'room' && wallTool) ? 'crosshair' : drag ? 'grabbing' : 'default'

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 overflow-hidden"
      style={{ cursor }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      data-testid="plan-canvas"
    >
      <PlanScene
        theme={theme}
        vp={vp}
        size={size}
        room={project.room}
        arch={arch}
        furniture={furniture}
        ghost={ghost}
        settings={settings}
        selection={selection}
        analysis={analysis}
        collisions={collisions}
        issues={arch.issues}
        guides={drag?.guides ?? []}
        measurements={project.measurements}
        measureDraft={measureDraftLine}
        wallDraft={wallDraftLine}
        mode={mode}
        interactive={!presentation}
        presentation={presentation}
        fmt={fmt}
        screenExtras={<g>{handles}</g>}
        svgProps={{
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
          onDoubleClick,
          'data-testid': 'plan-svg',
        } as React.SVGProps<SVGSVGElement>}
      />
    </div>
  )
}

/** Resize a (possibly rotated) box by dragging one of its 8 handles, keeping the opposite edge fixed. */
function resizeBox(
  box: { cx: number; cy: number; w: number; d: number; rot: number },
  sx: number,
  sy: number,
  local: Vec,
  fine: boolean,
): { cx: number; cy: number; w: number; d: number } {
  const q = (v: number) => (fine ? Math.round(v * 16) / 16 : Math.round(v * 8) / 8)
  let { w, d } = box
  let shiftX = 0
  let shiftY = 0
  if (sx !== 0) {
    const edge = q(local.x)
    const fixed = (-sx * box.w) / 2
    w = Math.max(1, sx * (edge - fixed))
    shiftX = (fixed + (fixed + sx * w)) / 2
  }
  if (sy !== 0) {
    const edge = q(local.y)
    const fixed = (-sy * box.d) / 2
    d = Math.max(1, sy * (edge - fixed))
    shiftY = (fixed + (fixed + sy * d)) / 2
  }
  const world = rotate({ x: shiftX, y: shiftY }, box.rot)
  return { cx: box.cx + world.x, cy: box.cy + world.y, w, d }
}
