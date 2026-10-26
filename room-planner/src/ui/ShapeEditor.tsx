import { useEffect, useMemo, useRef, useState } from 'react'
import { orientClockwise, validateOutline } from '../geometry/outline'
import { area, bbox, bboxCenter, bboxSize } from '../geometry/polygon'
import { closestPointOnSegment } from '../geometry/distance'
import { recentrePolygon } from '../geometry/shapes'
import { dist, type Vec } from '../geometry/vec'
import { newId } from '../model/ids'
import { FURNITURE_CATEGORIES, type FurnitureCategory, type FurnitureTemplate } from '../model/types'
import { addTemplateToPlan } from './LeftPanel'
import { useProject } from '../store/project'
import { useUi } from '../store/ui'
import { Button, IconButton, LengthInput, Row, Select, TextInput } from './kit'
import { formatLength } from '../geometry/units'

const PRESETS: Array<{ label: string; make: () => Vec[] }> = [
  { label: 'Rectangle', make: () => [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 24 }, { x: 0, y: 24 }] },
  { label: 'L-shape', make: () => [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 20 }, { x: 24, y: 20 }, { x: 24, y: 48 }, { x: 0, y: 48 }] },
  { label: 'U-shape', make: () => [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 36 }, { x: 42, y: 36 }, { x: 42, y: 18 }, { x: 18, y: 18 }, { x: 18, y: 36 }, { x: 0, y: 36 }] },
  { label: 'Angled corner', make: () => [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 24 }, { x: 24, y: 48 }, { x: 0, y: 48 }] },
  { label: 'Triangle', make: () => [{ x: 0, y: 48 }, { x: 24, y: 0 }, { x: 48, y: 48 }] },
]
const COLORS = ['#9aa3ad', '#1d1d1f', '#b78a62', '#c9b79c', '#7a8f7a', '#6d7f99', '#c8827a']

function useEditorTarget() {
  const target = useUi((s) => s.shapeEditor)
  const project = useProject((s) => s.project)
  return useMemo(() => {
    if (!target) return null
    if (target.kind === 'new') return { kind: 'new' as const }
    const layout = project.layouts.find((l) => l.id === project.activeLayoutId) ?? project.layouts[0]
    const item = layout.furniture.find((f) => f.id === target.id)
    return item ? { kind: 'item' as const, item } : null
  }, [target, project])
}

export function ShapeEditorDialog() {
  const target = useEditorTarget()
  if (!target) return null
  return <Editor key={target.kind === 'item' ? target.item.id : 'new'} target={target} />
}

function Editor({ target }: { target: NonNullable<ReturnType<typeof useEditorTarget>> }) {
  const units = useProject((s) => s.project.settings.units)
  const close = () => useUi.getState().openShapeEditor(null)
  const existing = target.kind === 'item' ? target.item : null

  const initial = useMemo<Vec[]>(() => {
    if (!existing) return PRESETS[0].make()
    if (existing.shape.kind === 'polygon') return existing.shape.vertices.map((v) => ({ ...v }))
    return [{ x: 0, y: 0 }, { x: existing.width, y: 0 }, { x: existing.width, y: existing.depth }, { x: 0, y: existing.depth }]
  }, [existing])
  const [pts, setPts] = useState<Vec[]>(() => {
    const b = bbox(initial)
    return initial.map((p) => ({ x: p.x - b.minX, y: p.y - b.minY }))
  })
  const [name, setName] = useState(existing?.name ?? 'Custom piece')
  const [category, setCategory] = useState<FurnitureCategory>(existing?.category ?? 'Custom')
  const [height, setHeight] = useState<number | null>(existing?.height ?? 30)
  const [color, setColor] = useState(existing?.color ?? COLORS[0])
  const [step, setStep] = useState('1')
  const [sel, setSel] = useState<number | null>(null)
  const svgRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ i: number } | null>(null)

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  // View: fixed padding around the shape and at least a 60 x 40 inch drawing area.
  const b = bbox(pts)
  const VW = 560
  const VH = 340
  const minX = Math.min(0, b.minX) - 6
  const minY = Math.min(0, b.minY) - 6
  const maxX = Math.max(b.maxX, 60) + 6
  const maxY = Math.max(b.maxY, 40) + 6
  const scale = Math.min(VW / (maxX - minX), VH / (maxY - minY))
  const ox = (VW - (maxX - minX) * scale) / 2 - minX * scale
  const oy = (VH - (maxY - minY) * scale) / 2 - minY * scale
  const toS = (p: Vec): Vec => ({ x: p.x * scale + ox, y: p.y * scale + oy })
  const toW = (cx: number, cy: number): Vec => {
    const r = svgRef.current!.getBoundingClientRect()
    const sx = ((cx - r.left) / r.width) * VW
    const sy = ((cy - r.top) / r.height) * VH
    return { x: (sx - ox) / scale, y: (sy - oy) / scale }
  }
  const stepN = Number(step)
  const snap = (p: Vec, alt: boolean): Vec => (alt || stepN === 0 ? { x: Math.round(p.x * 16) / 16, y: Math.round(p.y * 16) / 16 } : { x: Math.round(p.x / stepN) * stepN, y: Math.round(p.y / stepN) * stepN })

  const problems = validateOutline(pts)
  const size = bboxSize(b)
  const ok = problems.length === 0 && !!name.trim() && height !== null && size.w >= 0.5 && size.h >= 0.5
  const fmt = (n: number) => formatLength(n, { units, denom: 8 })

  const onPointerDown = (e: React.PointerEvent) => {
    const el = (e.target as Element).closest('[data-v]') as HTMLElement | null
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    if (el) {
      const i = Number(el.dataset.v)
      setSel(i)
      drag.current = { i }
      return
    }
    // click: on an edge inserts a corner there; elsewhere adds one after the selected corner (or at the end)
    const w = snap(toW(e.clientX, e.clientY), e.altKey)
    let bestEdge = -1
    let bestD = 6 / scale
    pts.forEach((a, i) => {
      const c = pts[(i + 1) % pts.length]
      const d = dist(closestPointOnSegment(w, a, c), w)
      if (d < bestD) {
        bestD = d
        bestEdge = i
      }
    })
    const at = bestEdge >= 0 ? bestEdge + 1 : sel !== null ? sel + 1 : pts.length
    setPts((cur) => [...cur.slice(0, at), w, ...cur.slice(at)])
    setSel(at)
    drag.current = { i: at }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const w = snap(toW(e.clientX, e.clientY), e.altKey)
    setPts((cur) => cur.map((p, i) => (i === d.i ? w : p)))
  }
  const onPointerUp = () => {
    drag.current = null
    // keep the shape anchored at the drawing origin
    setPts((cur) => {
      const bb = bbox(cur)
      return Math.abs(bb.minX) > 1e-9 || Math.abs(bb.minY) > 1e-9 ? cur.map((p) => ({ x: p.x - bb.minX, y: p.y - bb.minY })) : cur
    })
  }
  const removeSelected = () => {
    if (sel === null || pts.length <= 3) return
    setPts((cur) => cur.filter((_, i) => i !== sel))
    setSel(null)
  }
  const resize = (w: number | null, d: number | null) => {
    const sx = w !== null && size.w > 0 ? w / size.w : 1
    const sy = d !== null && size.h > 0 ? d / size.h : 1
    setPts((cur) => cur.map((p) => ({ x: p.x * sx, y: p.y * sy })))
  }

  const save = () => {
    if (!ok) return
    const oriented = orientClockwise(pts)
    const verts = recentrePolygon(oriented).map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }))
    const ext = bboxSize(bbox(verts))
    const store = useProject.getState()
    if (existing) {
      store.updateFurniture(existing.id, { shape: { kind: 'polygon', vertices: verts }, width: ext.w, depth: ext.h, name: name.trim(), category, height: height!, color })
      useUi.getState().showToast('Shape updated')
    } else {
      const tpl: FurnitureTemplate = { id: newId('tpl'), name: name.trim(), category, width: ext.w, depth: ext.h, height: height!, shape: { kind: 'polygon', vertices: verts }, color, workSide: 'none', collides: true, custom: true }
      store.saveTemplate(tpl)
      useUi.getState().setLibraryTab(category)
      addTemplateToPlan(tpl)
    }
    close()
  }

  const poly = pts.map((p) => toS(p))
  const c = bboxCenter(b)
  void c
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true" aria-label="Custom shape editor" data-testid="shape-editor" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pop thin-scroll flex max-h-full w-full max-w-[920px] flex-col overflow-y-auto rounded-2xl border border-line bg-solid shadow-float md:flex-row">
        <div className="min-w-0 flex-1 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[15px] font-semibold">{existing ? 'Edit footprint' : 'Draw a custom shape'}</div>
            <div className="flex items-center gap-1 text-[12px] text-ink2">Snap<Select value={step} width={84} onChange={setStep} options={[{ value: '0.5', label: '½″' }, { value: '1', label: '1″' }, { value: '3', label: '3″' }, { value: '6', label: '6″' }, { value: '0', label: 'Off' }]} /></div>
          </div>
          <div ref={svgRef} className="overflow-hidden rounded-xl border border-line bg-bg" style={{ touchAction: 'none' }}>
            <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" style={{ display: 'block', cursor: 'crosshair' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} data-testid="shape-svg">
              <defs>
                <pattern id="se-grid" width={12 * scale} height={12 * scale} patternUnits="userSpaceOnUse" x={ox} y={oy}>
                  <path d={`M ${12 * scale} 0 L 0 0 L 0 ${12 * scale}`} fill="none" stroke="var(--line)" strokeWidth={1} />
                </pattern>
              </defs>
              <rect width={VW} height={VH} fill="url(#se-grid)" />
              <polygon points={poly.map((p) => `${p.x},${p.y}`).join(' ')} fill={color} fillOpacity={0.85} stroke={problems.length ? 'var(--bad)' : 'var(--ink)'} strokeWidth={1.5} strokeLinejoin="round" />
              {pts.map((a, i) => {
                const c2 = pts[(i + 1) % pts.length]
                const m = toS({ x: (a.x + c2.x) / 2, y: (a.y + c2.y) / 2 })
                const len = dist(a, c2)
                if (len * scale < 34) return null
                return <text key={`l${i}`} x={m.x} y={m.y - 6} fontSize={11} textAnchor="middle" fill="var(--ink)" stroke="var(--solid)" strokeWidth={3} paintOrder="stroke" style={{ pointerEvents: 'none' }}>{fmt(len)}</text>
              })}
              {pts.map((p, i) => {
                const s = toS(p)
                return (
                  <g key={i} data-v={i} style={{ cursor: 'move' }}>
                    <circle cx={s.x} cy={s.y} r={13} fill="transparent" />
                    <circle cx={s.x} cy={s.y} r={sel === i ? 7 : 5.5} fill="var(--solid)" stroke="var(--accent)" strokeWidth={2.25} />
                  </g>
                )
              })}
            </svg>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => <Button key={p.label} variant="ghost" onClick={() => { setPts(p.make()); setSel(null) }}>{p.label}</Button>)}
          </div>
          <div className="mt-1 text-[11.5px] text-ink3">Click the outline to add a corner, drag a corner to move it. Alt bypasses snapping. Sizes are real inches — type exact values on the right.</div>
          {problems.length > 0 && <div className="mt-2 rounded-lg bg-badsoft p-2 text-[12px] text-bad" role="alert">{problems[0].message}</div>}
        </div>
        <div className="w-full shrink-0 border-t border-line p-4 md:w-[300px] md:border-l md:border-t-0">
          <TextInput value={name} onCommit={setName} placeholder="Name" className="mb-2 !h-8 font-semibold" />
          <Row label="Category"><Select value={category} width={130} onChange={(v) => setCategory(v as FurnitureCategory)} options={FURNITURE_CATEGORIES.map((c2) => ({ value: c2, label: c2 }))} /></Row>
          <Row label="Overall width"><LengthInput units={units} value={size.w} min={0.5} width={96} onCommit={(v) => v !== null && resize(v, null)} /></Row>
          <Row label="Overall depth"><LengthInput units={units} value={size.h} min={0.5} width={96} onCommit={(v) => v !== null && resize(null, v)} /></Row>
          <Row label="Height"><LengthInput units={units} value={height} nullable min={0.1} width={96} onCommit={setHeight} /></Row>
          <Row label="Footprint"><span className="text-[12.5px] tabular-nums text-ink2">{Math.round((area(pts) / 144) * 100) / 100} sq ft</span></Row>
          <div className="my-2 flex flex-wrap gap-1.5" role="group" aria-label="Colour">
            {COLORS.map((c2) => <button key={c2} type="button" aria-label={`Colour ${c2}`} aria-pressed={color === c2} onClick={() => setColor(c2)} className="h-6 w-6 rounded-full border border-line" style={{ background: c2, outline: color === c2 ? '2px solid var(--accent)' : 'none', outlineOffset: 2 }} />)}
          </div>
          <div className="mt-2 text-[12px] font-medium">Corners</div>
          <div className="mt-1 max-h-[170px] space-y-1 overflow-y-auto thin-scroll pr-1" data-testid="shape-corners">
            {pts.map((p, i) => (
              <div key={i} className={`flex items-center gap-1 rounded-lg px-1 ${sel === i ? 'bg-accentsoft' : ''}`} onClick={() => setSel(i)}>
                <span className="w-5 text-[11px] text-ink3">{i + 1}</span>
                <LengthInput units={units} value={p.x} min={-999} width={74} onCommit={(v) => v !== null && setPts((cur) => cur.map((q, j) => (j === i ? { ...q, x: v } : q)))} />
                <LengthInput units={units} value={p.y} min={-999} width={74} onCommit={(v) => v !== null && setPts((cur) => cur.map((q, j) => (j === i ? { ...q, y: v } : q)))} />
                <IconButton icon="close" label={`Remove corner ${i + 1}`} size={24} disabled={pts.length <= 3} onClick={() => { setPts((cur) => cur.filter((_, j) => j !== i)); setSel(null) }} />
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" disabled={!ok} onClick={save}>{existing ? 'Apply' : 'Add to library & plan'}</Button>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            {sel !== null && pts.length > 3 && <Button variant="ghost" icon="trash" onClick={removeSelected} title="Remove selected corner">Corner</Button>}
          </div>
        </div>
      </div>
    </div>
  )
}
