import { create } from 'zustand'
import type { Vec } from '../geometry/vec'
import type { Collision } from '../engine/collisions'
import type { Guide } from '../engine/snapping'

export type Mode = 'furniture' | 'room' | 'measure'
export type SelectionKind = 'furniture' | 'arch' | 'wall' | 'measurement'
export type MeasureMode = 'free' | 'horizontal' | 'vertical'
export type Sheet = 'library' | 'inspector' | 'layouts' | 'settings' | null
export type ShapeEditorTarget = { kind: 'new' } | { kind: 'item'; id: string }
export type CanvasCmd = 'fit' | 'center' | 'zoomIn' | 'zoomOut' | 'reset'

export interface Viewport {
  /** Pixels per inch. Purely a view setting: it never touches stored dimensions. */
  zoom: number
  /** Screen position (px) of room origin (0, 0). */
  panX: number
  panY: number
}

export interface DragInfo {
  id: string
  guides: Guide[]
  collisions: Collision[]
  /** Last non-colliding position (prevent-overlap mode). */
  note?: string
}

interface UiState {
  mode: Mode
  selection: { kind: SelectionKind; id: string } | null
  viewport: Viewport
  view: '2d' | '3d'
  sheet: Sheet
  measureMode: MeasureMode
  measureDraft: Vec | null
  wallDraft: Vec | null
  ghostLayoutId: string | null
  presentation: boolean
  drag: DragInfo | null
  snapSuspended: boolean
  libraryTab: string
  toast: string | null
  /** True while the Room-mode wall tool is armed. */
  wallTool: boolean
  canvasSize: { w: number; h: number }
  canvasCmd: { type: CanvasCmd; nonce: number } | null
  shapeEditor: ShapeEditorTarget | null
  /** Reference-image calibration: picking two points on the photo. */
  calibrating: { points: Vec[] } | null
  /** True while the reference photo is being dragged into place. */
  refEdit: boolean

  setMode: (m: Mode) => void
  select: (sel: UiState['selection']) => void
  setViewport: (v: Partial<Viewport>) => void
  setSheet: (s: Sheet) => void
  setMeasureMode: (m: MeasureMode) => void
  setMeasureDraft: (v: Vec | null) => void
  setWallDraft: (v: Vec | null) => void
  setGhost: (id: string | null) => void
  setPresentation: (b: boolean) => void
  setDrag: (d: DragInfo | null) => void
  setSnapSuspended: (b: boolean) => void
  setLibraryTab: (t: string) => void
  showToast: (msg: string | null) => void
  setWallTool: (b: boolean) => void
  setCanvasSize: (s: { w: number; h: number }) => void
  sendCanvasCmd: (type: CanvasCmd) => void
  openShapeEditor: (t: ShapeEditorTarget | null) => void
  setCalibrating: (c: { points: Vec[] } | null) => void
  setRefEdit: (b: boolean) => void
}

export const useUi = create<UiState>((set) => ({
  mode: 'furniture',
  selection: null,
  viewport: { zoom: 4, panX: 80, panY: 80 },
  view: '2d',
  sheet: null,
  measureMode: 'free',
  measureDraft: null,
  wallDraft: null,
  ghostLayoutId: null,
  presentation: false,
  drag: null,
  snapSuspended: false,
  libraryTab: 'Office',
  toast: null,
  wallTool: false,
  canvasSize: { w: 900, h: 640 },
  canvasCmd: null,
  shapeEditor: null,
  calibrating: null,
  refEdit: false,

  setMode: (mode) => set({ mode, selection: null, measureDraft: null, wallDraft: null, wallTool: false }),
  select: (selection) => set({ selection }),
  setViewport: (v) => set((s) => ({ viewport: { ...s.viewport, ...v } })),
  setSheet: (sheet) => set({ sheet }),
  setMeasureMode: (measureMode) => set({ measureMode, measureDraft: null }),
  setMeasureDraft: (measureDraft) => set({ measureDraft }),
  setWallDraft: (wallDraft) => set({ wallDraft }),
  setGhost: (ghostLayoutId) => set({ ghostLayoutId }),
  setPresentation: (presentation) => set(presentation ? { presentation, selection: null } : { presentation }),
  setDrag: (drag) => set({ drag }),
  setSnapSuspended: (snapSuspended) => set({ snapSuspended }),
  setLibraryTab: (libraryTab) => set({ libraryTab }),
  showToast: (toast) => set({ toast }),
  setWallTool: (wallTool) => set(wallTool ? { wallTool, wallDraft: null, selection: null } : { wallTool, wallDraft: null }),
  setCanvasSize: (canvasSize) => set({ canvasSize }),
  openShapeEditor: (shapeEditor) => set({ shapeEditor }),
  setCalibrating: (calibrating) => set({ calibrating }),
  setRefEdit: (refEdit) => set({ refEdit }),
  sendCanvasCmd: (type) => set((s) => ({ canvasCmd: { type, nonce: (s.canvasCmd?.nonce ?? 0) + 1 } })),
}))
