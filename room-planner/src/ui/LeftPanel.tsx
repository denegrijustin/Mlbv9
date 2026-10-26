import { useEffect, useMemo, useState } from 'react'
import { localPolygon, shapeExtent } from '../geometry/shapes'
import { bbox } from '../geometry/polygon'
import { toWorld } from '../canvas/view'
import { allTemplates } from '../model/library'
import { FURNITURE_CATEGORIES, type ArchType, type FurnitureTemplate } from '../model/types'
import { newId } from '../model/ids'
import { selectActiveLayout, useProject } from '../store/project'
import { useUi } from '../store/ui'
import { Button, Icon, IconButton, LengthInput, Pill, Section, TextInput, type IconName } from './kit'
import { MeasurementSections } from './Inspector'
import { useScene } from './useScene'

type Tab = 'library' | 'room' | 'layers'

export function LeftPanel() {
  const mode = useUi((s) => s.mode)
  const [tab, setTab] = useState<Tab>(mode === 'room' ? 'room' : 'library')
  useEffect(() => setTab(mode === 'room' ? 'room' : 'library'), [mode])
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 border-b border-line px-3 pt-3">
        {([['library', 'Furniture'], ['room', 'Room'], ['layers', 'Layers']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k} className={`relative rounded-t-lg px-3 pb-2 pt-1 text-[13px] font-medium transition ${tab === k ? 'text-ink' : 'text-ink2 hover:text-ink'}`}>
            {label}
            {tab === k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        {tab === 'library' && <Library />}
        {tab === 'room' && <RoomTools />}
        {tab === 'layers' && <Layers />}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ library
function TemplatePreview({ tpl }: { tpl: FurnitureTemplate }) {
  const poly = localPolygon(tpl.shape, tpl.width, tpl.depth)
  const b = bbox(poly)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const s = Math.min(64 / w, 40 / h)
  return (
    <svg width={72} height={48} viewBox={`${-36} ${-24} 72 48`} aria-hidden="true">
      <polygon points={poly.map((p) => `${(p.x - (b.minX + b.maxX) / 2) * s},${(p.y - (b.minY + b.maxY) / 2) * s}`).join(' ')} fill={tpl.color} stroke="rgba(0,0,0,0.25)" strokeWidth={1} strokeLinejoin="round" />
    </svg>
  )
}

export function addTemplateToPlan(tpl: FurnitureTemplate) {
  const ui = useUi.getState()
  const proj = useProject.getState()
  const c = toWorld(ui.viewport, { x: ui.canvasSize.w / 2, y: ui.canvasSize.h / 2 })
  const room = proj.project.room
  const at = { x: room.width !== null ? Math.min(Math.max(c.x, 0), room.width) : Math.max(c.x, 0), y: room.depth !== null ? Math.min(Math.max(c.y, 0), room.depth) : Math.max(c.y, 0) }
  const id = proj.addFurniture(tpl, at)
  ui.setMode('furniture')
  ui.select({ kind: 'furniture', id })
}

function Library() {
  const { project, settings } = useScene()
  const tabCat = useUi((s) => s.libraryTab)
  const setCat = useUi((s) => s.setLibraryTab)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const templates = useMemo(() => allTemplates(project.customTemplates), [project.customTemplates])
  const list = templates.filter((t) => (tabCat === 'All' || t.category === tabCat) && t.name.toLowerCase().includes(q.toLowerCase()))
  const fmtDim = (t: FurnitureTemplate) => {
    const e = shapeExtent(t.shape, t.width, t.depth)
    return `${fmt(e.width)} × ${fmt(e.depth)}`
  }
  const { fmt } = useScene()
  void settings

  return (
    <div className="p-3">
      <div className="relative mb-2">
        <Icon name="search" size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search furniture" className="h-8 w-full rounded-lg bg-fill pl-8 pr-2 text-[13px] outline-none focus:bg-solid" />
      </div>
      <div className="thin-scroll -mx-1 mb-2 flex gap-1 overflow-x-auto px-1 pb-1">
        {['All', ...FURNITURE_CATEGORIES].map((c) => (
          <button key={c} type="button" onClick={() => setCat(c)} aria-pressed={tabCat === c} className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium transition ${tabCat === c ? 'bg-ink text-bg' : 'bg-fill text-ink2 hover:text-ink'}`} style={tabCat === c ? { background: 'var(--ink)', color: 'var(--bg)' } : undefined}>
            {c}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {list.map((t) => (
          <div key={t.id} className="group relative">
            <button
              type="button"
              draggable
              onDragStart={(e) => e.dataTransfer.setData('application/x-room-template', t.id)}
              onClick={() => addTemplateToPlan(t)}
              title={`Add ${t.name} — or drag it onto the plan`}
              data-testid={`tpl-${t.id}`}
              className="flex w-full flex-col items-center rounded-xl border border-line bg-solid px-2 pb-2 pt-3 text-center transition hover:border-accent hover:shadow-panel"
            >
              <TemplatePreview tpl={t} />
              <div className="mt-1.5 w-full truncate text-[12.5px] font-medium">{t.name}</div>
              <div className="text-[11px] tabular-nums text-ink3">{fmtDim(t)}</div>
            </button>
            {t.custom && <button type="button" aria-label={`Remove ${t.name} from library`} onClick={() => useProject.getState().removeTemplate(t.id)} className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-fill text-ink2 hover:text-bad group-hover:flex"><Icon name="close" size={12} /></button>}
          </div>
        ))}
      </div>
      {list.length === 0 && <div className="py-6 text-center text-[12px] text-ink3">Nothing matches “{q}”.</div>}
      <div className="mt-3">
        {adding ? <NewItemForm onDone={() => setAdding(false)} /> : <Button full icon="plus" onClick={() => setAdding(true)}>New custom item</Button>}
        <div className="mt-2 text-[11px] leading-snug text-ink3">Starter sizes are typical dimensions, not your measurements. Select anything on the plan to edit its exact size.</div>
      </div>
    </div>
  )
}

function NewItemForm({ onDone }: { onDone: () => void }) {
  const units = useProject((s) => s.project.settings.units)
  const [name, setName] = useState('My item')
  const [w, setW] = useState<number | null>(36)
  const [d, setD] = useState<number | null>(24)
  const [h, setH] = useState<number | null>(30)
  const ok = !!name.trim() && w !== null && d !== null && h !== null
  return (
    <div className="space-y-2 rounded-xl bg-fill p-3">
      <TextInput value={name} onCommit={setName} placeholder="Name" />
      <div className="flex items-center justify-between text-[12px] text-ink2">Width<LengthInput units={units} value={w} onCommit={setW} min={0.5} width={96} /></div>
      <div className="flex items-center justify-between text-[12px] text-ink2">Depth<LengthInput units={units} value={d} onCommit={setD} min={0.5} width={96} /></div>
      <div className="flex items-center justify-between text-[12px] text-ink2">Height<LengthInput units={units} value={h} onCommit={setH} min={0.1} width={96} /></div>
      <div className="flex gap-2">
        <Button variant="primary" disabled={!ok} onClick={() => {
          const tpl: FurnitureTemplate = { id: newId('tpl'), name: name.trim(), category: 'Custom', width: w!, depth: d!, height: h!, shape: { kind: 'rect' }, color: '#9aa3ad', workSide: 'none', collides: true, custom: true }
          useProject.getState().saveTemplate(tpl)
          useUi.getState().setLibraryTab('Custom')
          onDone()
        }}>Add to library</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      <div className="text-[11px] text-ink3">Polygon shapes (like the L-desk) can be built from rectangles in the custom shape editor, coming in Wave 2.</div>
    </div>
  )
}

// ------------------------------------------------------------------ room tools
const TOOLS: Array<{ type: ArchType | 'wall' | 'opening'; label: string; icon: IconName; hint: string }> = [
  { type: 'wall', label: 'Interior wall', icon: 'wall', hint: 'Click points on the plan' },
  { type: 'pillar', label: 'Pillar', icon: 'pillar', hint: 'Column or post' },
  { type: 'builtin', label: 'Built-in', icon: 'bookcase', hint: 'Bookcase, closet, cabinet' },
  { type: 'door', label: 'Door', icon: 'door', hint: 'Hinge and swing arc' },
  { type: 'opening', label: 'Doorway', icon: 'opening', hint: 'Open passage' },
  { type: 'window', label: 'Window', icon: 'window', hint: 'Attached to a wall' },
  { type: 'tv', label: 'Wall TV', icon: 'tv', hint: 'Wall-mounted' },
]

function RoomTools() {
  const wallTool = useUi((s) => s.wallTool)
  const setWallTool = useUi((s) => s.setWallTool)
  const setMode = useUi((s) => s.setMode)
  const add = (type: (typeof TOOLS)[number]['type']) => {
    const store = useProject.getState()
    useUi.getState().setMode('room')
    if (type === 'wall') return setWallTool(!useUi.getState().wallTool)
    const id = type === 'opening' ? store.addArch('door', { style: 'opening', name: 'Doorway' }) : store.addArch(type)
    useUi.getState().select({ kind: 'arch', id })
  }
  return (
    <div>
      <Section title="Add to the room">
        <div className="grid grid-cols-2 gap-2">
          {TOOLS.map((t) => {
            const active = t.type === 'wall' && wallTool
            return (
              <button key={t.label} type="button" onClick={() => add(t.type)} aria-pressed={active} data-testid={`tool-${t.type}`} title={t.hint} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition ${active ? 'border-accent bg-accentsoft text-accent' : 'border-line bg-solid hover:border-accent'}`}>
                <Icon name={t.icon} size={18} />
                <span className="text-[12.5px] font-medium leading-tight">{t.label}</span>
              </button>
            )
          })}
        </div>
        {wallTool && <div className="mt-2 rounded-lg bg-accentsoft p-2 text-[12px] text-accent">Click to start a wall, click again to end it. Double-click or press Esc when done. Hold Alt to bypass snapping.</div>}
        <div className="mt-2 text-[11px] text-ink3">New items start unmeasured. Nothing is placed from photographs.</div>
      </Section>
      <MeasurementSections />
      <Section title="Room">
        <Button full icon="sliders" onClick={() => { setMode('room'); useUi.getState().select(null) }}>Room dimensions and rules</Button>
      </Section>
    </div>
  )
}

// ------------------------------------------------------------------ layers
function Layers() {
  const { layout, arch } = useScene()
  const selection = useUi((s) => s.selection)
  const select = useUi((s) => s.select)
  const update = useProject.getState().updateFurniture
  void selectActiveLayout
  return (
    <div>
      <Section title={`In ${layout.name}`}>
        {layout.furniture.length === 0 && <div className="text-[12px] text-ink3">No furniture yet. Add some from the Furniture tab.</div>}
        <ul className="space-y-0.5">
          {layout.furniture.map((f) => (
            <li key={f.id} className={`flex items-center gap-1 rounded-lg px-1.5 py-1 ${selection?.id === f.id ? 'bg-accentsoft' : 'hover:bg-fill'}`}>
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => select({ kind: 'furniture', id: f.id })}>
                <span className="h-3 w-3 shrink-0 rounded-sm border border-line" style={{ background: f.color }} />
                <span className={`truncate text-[13px] ${f.hidden ? 'text-ink3 line-through' : ''}`}>{f.name}</span>
              </button>
              <IconButton icon={f.hidden ? 'eyeOff' : 'eye'} label={f.hidden ? 'Show' : 'Hide'} size={26} onClick={() => update(f.id, { hidden: !f.hidden })} />
              <IconButton icon={f.locked ? 'lock' : 'unlock'} label={f.locked ? 'Unlock' : 'Lock'} size={26} active={f.locked} onClick={() => update(f.id, { locked: !f.locked })} />
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Architecture">
        <ul className="space-y-0.5">
          {arch.arch.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => select({ kind: 'arch', id: a.id })} className={`flex w-full items-center justify-between rounded-lg px-1.5 py-1 text-left hover:bg-fill ${selection?.id === a.id ? 'bg-accentsoft' : ''}`}>
                <span className="truncate text-[13px]">{a.item.name}</span>
                {!a.placed ? <Pill tone="warn">needs size</Pill> : a.item.locked ? <Icon name="lock" size={13} className="text-ink3" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
