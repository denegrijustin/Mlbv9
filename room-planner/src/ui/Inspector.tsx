import { useMemo, useState, type ReactNode } from 'react'
import { analyseFurniture } from '../engine/analysis'
import { bbox } from '../geometry/polygon'
import { validateLDesk, type LDeskShape } from '../geometry/shapes'
import { formatAngle } from '../geometry/units'
import { newId } from '../model/ids'
import { SEED_DESK_TEMPLATE } from '../model/library'
import type { ArchItem, BuiltIn, DoorItem, FurnitureItem, InteriorWall, WallTV, WindowItem } from '../model/types'
import { useProject } from '../store/project'
import { useUi } from '../store/ui'
import { Button, IconButton, LengthInput, NumInput, Pill, Row, Section, Segmented, Select, StatusDot, Switch, TextInput } from './kit'
import { useScene } from './useScene'
import { useIsMobile } from './useMedia'
import type { Issue } from '../engine/room'
import { furniturePolygon } from '../engine/scene'

const SWATCHES = ['#1d1d1f', '#5b6470', '#8a97a5', '#c8a27c', '#9c7a5b', '#d9d2c7', '#6fa57a', '#e8c76a', '#c26a5a']

export function Inspector() {
  const { project, layout } = useScene()
  const selection = useUi((s) => s.selection)
  if (selection?.kind === 'furniture') {
    const f = layout.furniture.find((x) => x.id === selection.id)
    if (f) return <FurnitureInspector item={f} />
  }
  if (selection?.kind === 'arch') {
    const a = project.room.items.find((x) => x.id === selection.id)
    if (a) return <ArchInspector item={a} />
  }
  if (selection?.kind === 'wall') return <WallInspector id={selection.id} />
  return <RoomPanel />
}

// ------------------------------------------------------------------ helpers
function Header({ title, subtitle, onClose, children }: { title: ReactNode; subtitle?: ReactNode; onClose?: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{title}</div>
        {subtitle && <div className="text-[12px] text-ink2">{subtitle}</div>}
        {children}
      </div>
      {onClose && <IconButton icon="close" label="Deselect" onClick={onClose} size={28} />}
    </div>
  )
}

function ConfirmDelete({ onConfirm, label = 'Delete' }: { onConfirm: () => void; label?: string }) {
  const [armed, setArmed] = useState(false)
  return armed ? (
    <Button variant="danger" onClick={onConfirm} icon="trash">Confirm {label.toLowerCase()}</Button>
  ) : (
    <Button variant="ghost" icon="trash" onClick={() => { setArmed(true); setTimeout(() => setArmed(false), 3000) }}>{label}</Button>
  )
}

export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null
  return (
    <div className="space-y-2">
      {issues.map((i) => (
        <div key={i.id} className={`rounded-lg p-2.5 text-[12px] ${i.severity === 'error' ? 'bg-badsoft' : 'bg-warnsoft'}`}>
          <div className={`font-medium ${i.severity === 'error' ? 'text-bad' : 'text-warn'}`}>{i.severity === 'error' ? 'Measurements conflict' : 'Check these measurements'}</div>
          <div className="mt-0.5 text-ink">{i.message}</div>
          {i.measurements.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{i.measurements.map((m) => <Pill key={m} tone={i.severity === 'error' ? 'bad' : 'warn'}>{m}</Pill>)}</div>}
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ furniture
function FurnitureInspector({ item }: { item: FurnitureItem }) {
  const { settings, ctx, fmt } = useScene()
  const p = useProject.getState
  const update = (patch: Partial<FurnitureItem>) => p().updateFurniture(item.id, patch)
  const units = settings.units
  const analysis = useMemo(() => analyseFurniture(item, ctx), [item, ctx])
  const bb = bbox(furniturePolygon(item))
  const select = useUi((s) => s.select)
  const [ldeskMsg, setLdeskMsg] = useState<string | null>(null)
  const isParam = item.shape.kind === 'ldesk'

  const headline = analysis.status === 'collision'
    ? analysis.collisions.length ? `Doesn't fit here — overlaps ${analysis.collisions.map((c) => c.label).join(', ')}` : "Doesn't fit — not enough chair space"
    : analysis.status === 'tight' ? 'Fits, but the chair space is tight' : 'Fits here'
  const tone = analysis.status === 'collision' ? 'bg-badsoft text-bad' : analysis.status === 'tight' ? 'bg-warnsoft text-warn' : 'bg-goodsoft text-good'

  const setL = (patch: Partial<LDeskShape>) => {
    const next = { ...(item.shape as LDeskShape), ...patch }
    const issues = validateLDesk(next)
    if (issues.length) return setLdeskMsg(issues[0].message)
    setLdeskMsg(null)
    update({ shape: next })
  }

  const saveTemplate = () => {
    const tid = item.templateId?.startsWith('tpl-my') ? item.templateId : newId('tpl')
    p().saveTemplate({ id: tid, name: item.name, category: 'Custom', width: item.width, depth: item.depth, height: item.height, shape: structuredClone(item.shape), color: item.color, workSide: item.workSide, collides: item.collides, ...(item.role ? { role: item.role } : {}), custom: true })
    useUi.getState().showToast(`Saved "${item.name}" to your library`)
  }

  return (
    <div className="pop">
      <Header title={<TextInput value={item.name} onCommit={(v) => update({ name: v || item.name })} className="!h-7 !bg-transparent !px-0 text-[15px] font-semibold focus:!bg-solid focus:!px-2" />} subtitle={`${item.category}${item.locked ? ' · locked' : ''}`} onClose={() => select(null)} />

      <Section title="Fit check">
        <div className={`rounded-xl p-3 ${tone}`} data-testid="fit-headline">
          <div className="text-[13px] font-semibold">{headline}</div>
        </div>
        <div className="mt-2 space-y-1 text-[13px]">
          <Row label="Nearest wall">{analysis.nearestWall ? <span className="tabular-nums">{fmt(analysis.nearestWall.distance)} <span className="text-ink3">· {analysis.nearestWall.label}</span></span> : <span className="text-ink3">—</span>}</Row>
          <Row label="Nearest furniture">{analysis.nearestFurniture ? <span className="tabular-nums">{fmt(analysis.nearestFurniture.distance)} <span className="text-ink3">· {analysis.nearestFurniture.label}</span></span> : <span className="text-ink3">None</span>}</Row>
          {analysis.chairZone && (
            <Row label="Chair space">
              <span className="flex items-center gap-1.5 tabular-nums"><StatusDot status={analysis.chairZone.status} />{analysis.chairZone.free >= analysis.chairZone.required - 1e-6 ? `${fmt(analysis.chairZone.required)}+ clear` : `${fmt(analysis.chairZone.free)} of ${fmt(analysis.chairZone.required)}`}</span>
            </Row>
          )}
          {analysis.tightest && <Row label="Tight gap"><span className="tabular-nums text-warn">{fmt(analysis.tightest.distance)} <span className="text-ink3">· {analysis.tightest.label}</span></span></Row>}
          <Row label="Collision">{analysis.collisions.length ? <span className="font-medium text-bad">{analysis.collisions.map((c) => c.label).join(', ')}</span> : <span className="text-good">None</span>}</Row>
        </div>
      </Section>

      <Section title="Size">
        {isParam ? (
          <>
            <Row label="Main length"><LengthInput units={units} value={(item.shape as LDeskShape).mainLength} onCommit={(v) => setL({ mainLength: v ?? 0 })} min={1} testId="ldesk-main-length" /></Row>
            <Row label="Main depth"><LengthInput units={units} value={(item.shape as LDeskShape).mainDepth} onCommit={(v) => setL({ mainDepth: v ?? 0 })} min={1} /></Row>
            <Row label="Return length" hint={(item.shape as LDeskShape).returnMeasure === 'outer' ? 'Along the outer edge, end to end' : 'Beyond the main run'}><LengthInput units={units} value={(item.shape as LDeskShape).returnLength} onCommit={(v) => setL({ returnLength: v ?? 0 })} min={1} testId="ldesk-return-length" /></Row>
            <Row label="Return measured"><Segmented size="sm" label="Return length measured" value={(item.shape as LDeskShape).returnMeasure} onChange={(v) => setL({ returnMeasure: v, returnLength: v === 'outer' ? (item.shape as LDeskShape).mainDepth + (item.shape as LDeskShape).returnLength : Math.max(1, (item.shape as LDeskShape).returnLength - (item.shape as LDeskShape).mainDepth) })} options={[{ value: 'outer', label: 'Overall' }, { value: 'beyond', label: 'Past main' }]} /></Row>
            <Row label="Return width"><LengthInput units={units} value={(item.shape as LDeskShape).returnWidth} onCommit={(v) => setL({ returnWidth: v ?? 0 })} min={1} /></Row>
            <Row label="Inside curve radius" hint="Estimate: not measured"><LengthInput units={units} value={(item.shape as LDeskShape).innerRadius} onCommit={(v) => setL({ innerRadius: v ?? 0 })} min={0} /></Row>
            <Row label="Return on"><Segmented size="sm" label="Return side" value={(item.shape as LDeskShape).returnSide} onChange={(v) => setL({ returnSide: v })} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} /></Row>
            <Row label="Overall footprint"><span className="text-[13px] tabular-nums text-ink2">{fmt(item.width)} × {fmt(item.depth)}</span></Row>
            {ldeskMsg && <div className="mt-1 rounded-lg bg-badsoft p-2 text-[12px] text-bad">{ldeskMsg}</div>}
          </>
        ) : item.shape.kind === 'polygon' ? (
          <Row label="Overall footprint"><span className="text-[13px] tabular-nums text-ink2">{fmt(item.width)} × {fmt(item.depth)}</span></Row>
        ) : (
          <>
            <Row label="Width"><LengthInput units={units} value={item.width} onCommit={(v) => update({ width: v ?? item.width })} min={0.5} testId="f-width" /></Row>
            <Row label="Depth"><LengthInput units={units} value={item.depth} onCommit={(v) => update({ depth: v ?? item.depth })} min={0.5} testId="f-depth" /></Row>
          </>
        )}
        <Row label="Height"><LengthInput units={units} value={item.height} onCommit={(v) => update({ height: v ?? item.height })} min={0.1} /></Row>
      </Section>

      <Section title="Position">
        <Row label="X" hint="Distance from the west wall"><LengthInput units={units} value={bb.minX} min={-9999} onCommit={(v) => v !== null && update({ x: item.x + (v - bb.minX) })} testId="f-x" /></Row>
        <Row label="Y" hint="Distance from the north wall"><LengthInput units={units} value={bb.minY} min={-9999} onCommit={(v) => v !== null && update({ y: item.y + (v - bb.minY) })} testId="f-y" /></Row>
        <Row label="Rotation"><NumInput value={item.rotation} suffix="°" min={0} max={359.99} onCommit={(v) => update({ rotation: ((v % 360) + 360) % 360 })} testId="f-rotation" /></Row>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex gap-1">
            <IconButton icon="rotL" label="Rotate left 90°" onClick={() => p().rotateFurniture(item.id, -90)} disabled={item.locked} />
            <IconButton icon="rotR" label="Rotate right 90°" onClick={() => p().rotateFurniture(item.id, 90)} disabled={item.locked} />
            <IconButton icon="flipH" label="Flip horizontal" onClick={() => p().mirrorFurniture(item.id, 'x')} disabled={item.locked} />
            <IconButton icon="flipV" label="Flip vertical" onClick={() => p().mirrorFurniture(item.id, 'y')} disabled={item.locked} />
          </div>
          <span className="text-[12px] tabular-nums text-ink3">{formatAngle(item.rotation)}</span>
        </div>
      </Section>

      <Section title="Clearances" action={<Pill tone="neutral">{analysis.clearances.length}</Pill>}>
        <div className="space-y-0.5">
          {analysis.clearances.slice(0, 9).map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 py-0.5 text-[12.5px]" title={c.note}>
              <span className="flex min-w-0 items-center gap-2"><StatusDot status={c.status} /><span className="truncate">{c.label}</span></span>
              <span className={`tabular-nums ${c.status === 'collision' ? 'font-medium text-bad' : c.status === 'tight' ? 'text-warn' : 'text-ink2'}`}>{c.status === 'collision' ? 'overlap' : c.status === 'flush' ? 'flush' : fmt(c.distance)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2 text-[11px] text-ink3"><span className="flex items-center gap-1"><StatusDot status="good" />good</span><span className="flex items-center gap-1"><StatusDot status="tight" />tight</span><span className="flex items-center gap-1"><StatusDot status="collision" />collision</span></div>
      </Section>

      <Section title="Appearance">
        <div className="flex flex-wrap items-center gap-1.5">
          {SWATCHES.map((c) => (
            <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => update({ color: c })} className={`h-6 w-6 rounded-full border ${item.color === c ? 'ring-2 ring-accent ring-offset-1' : 'border-line'}`} style={{ background: c }} />
          ))}
          <input type="color" value={item.color} onChange={(e) => update({ color: e.target.value })} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" aria-label="Custom colour" />
        </div>
        <Row label="Counts as an obstacle" hint="Rugs: off"><Switch label="Counts as an obstacle" checked={item.collides} onChange={(v) => update({ collides: v })} /></Row>
      </Section>

      <Section title="Actions">
        <div className="flex flex-wrap gap-1.5">
          <Button icon={item.locked ? 'lock' : 'unlock'} onClick={() => update({ locked: !item.locked })} variant={item.locked ? 'primary' : 'secondary'}>{item.locked ? 'Locked' : 'Lock'}</Button>
          <Button icon={item.hidden ? 'eyeOff' : 'eye'} onClick={() => update({ hidden: !item.hidden })}>{item.hidden ? 'Hidden' : 'Hide'}</Button>
          <Button icon="copy" onClick={() => { const id = p().duplicateFurniture(item.id); if (id) select({ kind: 'furniture', id }) }}>Duplicate</Button>
          <Button icon="save" onClick={saveTemplate}>Save to library</Button>
          <Button variant="danger" icon="trash" onClick={() => { p().removeFurniture([item.id]); select(null) }}>Delete</Button>
        </div>
        {item.templateId === SEED_DESK_TEMPLATE.id && <div className="mt-2 text-[11px] text-ink3">Built from your measurements: 64″ main run × 24″ deep, 43½″ return, 21″ narrow end.</div>}
      </Section>

      <Section title="Notes">
        <textarea defaultValue={item.notes ?? ''} key={item.id} onBlur={(e) => e.target.value !== (item.notes ?? '') && update({ notes: e.target.value })} rows={2} placeholder="Add a note" className="w-full resize-none rounded-lg bg-fill p-2 text-[13px] outline-none focus:bg-solid" />
      </Section>
    </div>
  )
}

// ------------------------------------------------------------------ architecture
function ArchInspector({ item }: { item: ArchItem }) {
  const { settings, arch } = useScene()
  const units = settings.units
  const store = useProject.getState
  const set = (patch: Record<string, unknown>) => store().updateArch(item.id, patch as Partial<ArchItem>)
  const select = useUi((s) => s.select)
  const resolved = arch.arch.find((a) => a.id === item.id)
  const issues = arch.issues.filter((i) => i.itemIds.includes(item.id))
  const walls = arch.room.walls
  const perim = (['north', 'east', 'south', 'west'] as const).map((id) => ({ id, label: `${id[0].toUpperCase()}${id.slice(1)} wall`, exists: walls.some((w) => w.id === id) }))
  const interior = walls.filter((w) => w.kind === 'interior').map((w) => ({ id: w.id, label: w.name, exists: true }))
  const wallOptions = [{ value: '', label: 'Choose a wall…' }, ...[...perim, ...interior].map((w) => ({ value: w.id, label: w.exists ? w.label : `${w.label} (needs ${w.id === 'east' ? 'width' : 'depth'})`, disabled: !w.exists }))]
  const wallId = 'wallId' in item ? item.wallId : null
  const wall = wallId ? walls.find((w) => w.id === wallId) : undefined
  const fromWhere = !wall ? '' : wall.kind === 'interior' ? 'from the wall’s start point' : wall.id === 'north' || wall.id === 'south' ? 'from the west corner' : 'from the north corner'
  const typeLabel = { pillar: 'Pillar / column', builtin: 'Built-in', door: (item as DoorItem).style === 'opening' ? 'Doorway / opening' : 'Door', window: 'Window', tv: 'Wall-mounted TV' }[item.type]

  const L = (label: string, field: string, value: number | null, opts: { required?: boolean; hint?: string; min?: number; testId?: string } = {}) => (
    <Row label={label} hint={opts.hint} flag={opts.required && value === null}>
      <LengthInput units={units} value={value} nullable onCommit={(v) => set({ [field]: v })} flag={opts.required && value === null} min={opts.min ?? 0} testId={opts.testId} />
    </Row>
  )

  const wallPicker = (
    <Row label="Wall" flag={wallId === null}>
      <Select value={wallId ?? ''} flag={wallId === null} width={150} onChange={(v) => set({ wallId: v || null })} options={wallOptions} />
    </Row>
  )

  return (
    <div className="pop">
      <Header title={<TextInput value={item.name} onCommit={(v) => set({ name: v || item.name })} className="!h-7 !bg-transparent !px-0 text-[15px] font-semibold focus:!bg-solid focus:!px-2" />} subtitle={typeLabel} onClose={() => select(null)} />
      {resolved && resolved.missing.length > 0 && (
        <div className="mx-4 mt-3 rounded-xl bg-warnsoft p-3 text-[12px]" data-testid="needs-measurements">
          <div className="font-semibold text-warn">Needs measurements to appear on the plan</div>
          <div className="mt-1.5 flex flex-wrap gap-1">{resolved.missing.map((m) => <Pill key={m} tone="warn">{m}</Pill>)}</div>
          <div className="mt-1.5 text-ink2">Nothing is estimated from the photos. Enter what you measured; leave the rest blank.</div>
        </div>
      )}
      {issues.length > 0 && <div className="px-4 pt-3"><IssueList issues={issues} /></div>}

      {(item.type === 'pillar' || item.type === 'builtin') && (
        <>
          <Section title="Position">
            {L('From west wall', 'x', item.x, { required: true, hint: 'To the left edge', min: -9999 })}
            {L('From north wall', 'y', item.y, { required: true, hint: 'To the top edge', min: -9999 })}
            <Row label="Rotation"><NumInput value={item.rotation} suffix="°" min={0} max={359.99} onCommit={(v) => set({ rotation: ((v % 360) + 360) % 360 })} /></Row>
          </Section>
          <Section title="Size">
            {L('Width', 'width', item.width, { required: true, testId: 'a-width' })}
            {L('Depth', 'depth', item.depth, { required: true, testId: 'a-depth' })}
            {L('Height', 'height', item.height, { hint: 'For the 3D view' })}
            {item.type === 'builtin' && (
              <Row label="Kind"><Select value={(item as BuiltIn).kind} width={130} onChange={(v) => set({ kind: v })} options={[{ value: 'bookcase', label: 'Bookcase' }, { value: 'closet', label: 'Closet' }, { value: 'cabinet', label: 'Cabinet' }, { value: 'other', label: 'Other' }]} /></Row>
            )}
          </Section>
        </>
      )}

      {item.type === 'door' && (
        <>
          <Section title="Type">
            <Row label="Style"><Segmented size="sm" label="Door style" value={(item as DoorItem).style} onChange={(v) => set({ style: v })} options={[{ value: 'door', label: 'Door' }, { value: 'opening', label: 'Opening' }]} /></Row>
          </Section>
          <Section title="Location">
            {wallPicker}
            {L('Position along wall', 'offset', (item as DoorItem).offset, { required: true, hint: fromWhere || 'Distance to the nearest edge', testId: 'a-offset' })}
            {L('Opening width', 'width', (item as DoorItem).width, { required: true, testId: 'a-width' })}
            {L('Height', 'height', (item as DoorItem).height, { hint: 'For the 3D view' })}
          </Section>
          {(item as DoorItem).style === 'door' && (
            <Section title="Swing">
              <Row label="Hinge"><Segmented size="sm" label="Hinge" value={(item as DoorItem).hinge} onChange={(v) => set({ hinge: v })} options={[{ value: 'start', label: wall && (wall.id === 'east' || wall.id === 'west') ? 'North end' : 'Left end' }, { value: 'end', label: wall && (wall.id === 'east' || wall.id === 'west') ? 'South end' : 'Right end' }]} /></Row>
              <Row label="Opens"><Segmented size="sm" label="Swing direction" value={(item as DoorItem).swing} onChange={(v) => set({ swing: v })} options={[{ value: 'in', label: 'Inward' }, { value: 'out', label: 'Outward' }]} /></Row>
              <div className="mt-1 text-[11px] text-ink3">Furniture inside the swing arc triggers a clearance warning.</div>
            </Section>
          )}
        </>
      )}

      {item.type === 'window' && (
        <Section title="Location and size">
          {wallPicker}
          {L('Position along wall', 'offset', (item as WindowItem).offset, { required: true, hint: fromWhere || 'Distance to the nearest edge', testId: 'a-offset' })}
          {L('Width', 'width', (item as WindowItem).width, { required: true, testId: 'a-width' })}
          {L('Sill height', 'sill', (item as WindowItem).sill, { hint: 'Floor to glass, for 3D' })}
          {L('Height', 'height', (item as WindowItem).height, { hint: 'For the 3D view' })}
        </Section>
      )}

      {item.type === 'tv' && (
        <Section title="Location and size">
          {wallPicker}
          {L('Position along wall', 'offset', (item as WallTV).offset, { required: true, hint: fromWhere || 'Distance to the nearest edge' })}
          {L('Width', 'width', (item as WallTV).width, { required: true })}
          {L('Projection from wall', 'thickness', (item as WallTV).thickness, { hint: 'Shown as a footprint on the plan' })}
          {L('Mounting height', 'mountHeight', (item as WallTV).mountHeight, { hint: 'Floor to bottom of screen' })}
          {L('Screen height', 'height', (item as WallTV).height)}
        </Section>
      )}

      <Section title="Actions">
        <div className="flex flex-wrap gap-1.5">
          <Button icon={item.locked ? 'lock' : 'unlock'} variant={item.locked ? 'primary' : 'secondary'} onClick={() => set({ locked: !item.locked })}>{item.locked ? 'Locked' : 'Lock'}</Button>
          <ConfirmDelete onConfirm={() => { store().removeArch(item.id); select(null) }} />
        </div>
        <div className="mt-2 text-[11px] text-ink3">Locked items cannot be dragged by accident. You can still edit their numbers.</div>
      </Section>
      <Section title="Notes">
        <textarea defaultValue={item.notes ?? ''} key={item.id} onBlur={(e) => e.target.value !== (item.notes ?? '') && set({ notes: e.target.value })} rows={2} placeholder="Add a note" className="w-full resize-none rounded-lg bg-fill p-2 text-[13px] outline-none focus:bg-solid" />
      </Section>
    </div>
  )
}

// ------------------------------------------------------------------ walls
function WallInspector({ id }: { id: string }) {
  const { project, settings, arch } = useScene()
  const units = settings.units
  const store = useProject.getState
  const select = useUi((s) => s.select)
  const room = project.room
  const perimeter = ['north', 'east', 'south', 'west'].includes(id)
  const iw = room.interiorWalls.find((w) => w.id === id)
  const horizontal = id === 'north' || id === 'south'
  const issues = arch.issues.filter((i) => i.itemIds.includes(id))

  if (perimeter) {
    const dimName = horizontal ? 'width' : 'depth'
    const value = horizontal ? room.width : room.depth
    return (
      <div className="pop">
        <Header title={`${id[0].toUpperCase()}${id.slice(1)} wall`} subtitle="Perimeter wall" onClose={() => select(null)} />
        <Section title="Length">
          <Row label={`Wall length`} hint={`This is the room's ${horizontal ? 'east–west' : 'north–south'} ${dimName}`} flag={value === null}>
            <LengthInput units={units} value={value} nullable flag={value === null} onCommit={(v) => store().updateRoom(horizontal ? { width: v } : { depth: v })} min={1} testId="wall-length" />
          </Row>
          <div className="mt-1 text-[12px] text-ink3">{horizontal ? 'The north and south walls share this dimension.' : 'The east and west walls share this dimension.'} Inside surface to inside surface.</div>
          <div className="mt-2"><Button icon="move" onClick={() => store().swapRoomDimensions()}>Swap width and depth</Button></div>
        </Section>
        {issues.length > 0 && <Section title="Conflicts"><IssueList issues={issues} /></Section>}
      </div>
    )
  }
  if (!iw) return <RoomPanel />
  const setW = (patch: Partial<InteriorWall>) => store().updateInteriorWall(iw.id, patch)
  const len = Math.hypot(iw.b.x - iw.a.x, iw.b.y - iw.a.y)
  const dir = len > 0 ? { x: (iw.b.x - iw.a.x) / len, y: (iw.b.y - iw.a.y) / len } : { x: 1, y: 0 }
  return (
    <div className="pop">
      <Header title={<TextInput value={iw.name} onCommit={(v) => setW({ name: v || iw.name })} className="!h-7 !bg-transparent !px-0 text-[15px] font-semibold focus:!bg-solid focus:!px-2" />} subtitle="Interior wall" onClose={() => select(null)} />
      {issues.length > 0 && <div className="px-4 pt-3"><IssueList issues={issues} /></div>}
      <Section title="Length">
        <Row label="Length" hint="Moves the end point"><LengthInput units={units} value={len} min={1} onCommit={(v) => v !== null && setW({ b: { x: iw.a.x + dir.x * v, y: iw.a.y + dir.y * v } })} testId="wall-length" /></Row>
        <Row label="Thickness"><LengthInput units={units} value={iw.thickness} min={0.5} onCommit={(v) => v !== null && setW({ thickness: v })} /></Row>
      </Section>
      <Section title="End points (from the north-west corner)">
        <Row label="Start X"><LengthInput units={units} value={iw.a.x} min={-9999} onCommit={(v) => v !== null && setW({ a: { ...iw.a, x: v } })} /></Row>
        <Row label="Start Y"><LengthInput units={units} value={iw.a.y} min={-9999} onCommit={(v) => v !== null && setW({ a: { ...iw.a, y: v } })} /></Row>
        <Row label="End X"><LengthInput units={units} value={iw.b.x} min={-9999} onCommit={(v) => v !== null && setW({ b: { ...iw.b, x: v } })} /></Row>
        <Row label="End Y"><LengthInput units={units} value={iw.b.y} min={-9999} onCommit={(v) => v !== null && setW({ b: { ...iw.b, y: v } })} /></Row>
      </Section>
      <Section title="Actions">
        <div className="flex gap-1.5">
          <Button icon={iw.locked ? 'lock' : 'unlock'} variant={iw.locked ? 'primary' : 'secondary'} onClick={() => setW({ locked: !iw.locked })}>{iw.locked ? 'Locked' : 'Lock'}</Button>
          <ConfirmDelete onConfirm={() => { store().removeInteriorWall(iw.id); select(null) }} />
        </div>
      </Section>
    </div>
  )
}

/** Items still missing plan measurements (`optional` = only 3D-only heights are missing). */
export function UnresolvedList({ optional = false }: { optional?: boolean }) {
  const { arch } = useScene()
  const select = useUi((s) => s.select)
  const setMode = useUi((s) => s.setMode)
  const list = arch.unresolved.filter((u) => (optional ? u.missing.length === 0 && u.missingOptional.length > 0 : u.missing.length > 0))
  return (
    <div className="space-y-1.5" data-testid={optional ? 'optional-list' : 'unresolved-list'}>
      {list.map((u) => (
        <button key={u.id} type="button" onClick={() => { setMode('room'); if (u.id !== 'room') useUi.getState().select({ kind: 'arch', id: u.id }); else select(null) }} className="w-full rounded-lg bg-fill p-2 text-left hover:bg-[var(--fill-hover)]">
          <div className="text-[13px] font-medium">{u.name}</div>
          <div className="mt-1 flex flex-wrap gap-1">{u.missing.map((m) => <Pill key={m} tone="warn">{m}</Pill>)}{u.missing.length === 0 && u.missingOptional.map((m) => <Pill key={m}>{m} (3D)</Pill>)}</div>
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ room, rules, view
/** Conflicts, required measurements and optional 3D heights. */
export function MeasurementSections() {
  const { arch } = useScene()
  const required = arch.unresolved.filter((u) => u.missing.length > 0)
  const optional = arch.unresolved.filter((u) => u.missing.length === 0 && u.missingOptional.length > 0)
  return (
    <>
      {arch.issues.length > 0 && <Section title="Conflicts"><IssueList issues={arch.issues} /></Section>}
      <Section title="Needs measurements" action={<Pill tone={required.length ? 'warn' : 'good'}>{required.length || 'All set'}</Pill>}>
        {required.length > 0 ? <UnresolvedList /> : <div className="text-[12px] text-ink3">Every item has the measurements needed for the plan.</div>}
      </Section>
      {optional.length > 0 && (
        <Section title="Optional, for the 3D view" action={<Pill>{optional.length}</Pill>}>
          <UnresolvedList optional />
        </Section>
      )}
    </>
  )
}

function RoomPanel() {
  const [tab, setTab] = useState<'room' | 'rules' | 'view'>('room')
  const mode = useUi((s) => s.mode)
  const mobile = useIsMobile()
  // In Room mode on desktop the same lists are already in the left panel.
  const showLists = !(mode === 'room' && !mobile)
  const { project, settings } = useScene()
  const store = useProject.getState
  const units = settings.units
  const room = project.room
  const rules = settings.rules

  return (
    <div className="pop">
      <div className="border-b border-line px-4 py-3">
        <div className="text-[15px] font-semibold">{room.name}</div>
        <div className="mt-2"><Segmented size="sm" label="Panel" value={tab} onChange={setTab} options={[{ value: 'room', label: 'Room' }, { value: 'rules', label: 'Rules' }, { value: 'view', label: 'View' }]} /></div>
      </div>

      {tab === 'room' && (
        <>
          <Section title="Interior dimensions">
            <Row label="Width" hint="East–west" flag={room.width === null}><LengthInput units={units} value={room.width} nullable flag={room.width === null} onCommit={(v) => store().updateRoom({ width: v })} min={1} testId="room-width" /></Row>
            <Row label="Depth" hint="North–south" flag={room.depth === null}><LengthInput units={units} value={room.depth} nullable flag={room.depth === null} onCommit={(v) => store().updateRoom({ depth: v })} min={1} testId="room-depth" /></Row>
            <Row label="Ceiling height"><LengthInput units={units} value={room.ceilingHeight} nullable onCommit={(v) => store().updateRoom({ ceilingHeight: v })} min={1} /></Row>
            <div className="mt-1 flex items-center gap-2 text-[12px] text-ink3"><span>Inside surface to inside surface.</span><Button variant="ghost" icon="move" onClick={() => store().swapRoomDimensions()} title="Swap width and depth">Swap</Button></div>
          </Section>
          <Section title="Finish">
            <Row label="Floor"><Select value={room.floor} width={120} onChange={(v) => store().updateRoom({ floor: v })} options={[{ value: 'carpet', label: 'Carpet' }, { value: 'wood', label: 'Wood' }, { value: 'tile', label: 'Tile' }, { value: 'other', label: 'Other' }]} /></Row>
            <Row label="Wall thickness" hint="Display only"><LengthInput units={units} value={room.wallThickness} min={0.5} onCommit={(v) => v !== null && store().updateRoom({ wallThickness: v })} /></Row>
          </Section>
          {showLists && <MeasurementSections />}
        </>
      )}

      {tab === 'rules' && (
        <>
          <Section title="Clearance rules">
            <Row label="Walking path" hint="Minimum"><LengthInput units={units} value={rules.walkingPath} min={1} onCommit={(v) => v !== null && store().setRules({ walkingPath: v })} /></Row>
            <Row label="Comfortable path"><LengthInput units={units} value={rules.comfortablePath} min={1} onCommit={(v) => v !== null && store().setRules({ comfortablePath: v })} /></Row>
            <Row label="Office chair space" hint="Behind a desk"><LengthInput units={units} value={rules.chairClearance} min={1} onCommit={(v) => v !== null && store().setRules({ chairClearance: v })} /></Row>
            <Row label="Keep door swing clear"><Switch label="Keep door swing clear" checked={rules.keepDoorSwingClear} onChange={(v) => store().setRules({ keepDoorSwingClear: v })} /></Row>
          </Section>
          <Section title="Collisions">
            <Row label="When pieces overlap"><Segmented size="sm" label="Collision mode" value={settings.collisionMode} onChange={(v) => store().setSettings({ collisionMode: v })} options={[{ value: 'warn', label: 'Warn' }, { value: 'prevent', label: 'Block' }]} /></Row>
            <div className="mt-1 text-[11px] text-ink3">Warn lets pieces overlap and outlines the overlap in red. Block stops a piece at the point of contact.</div>
          </Section>
          <Section title="Colour key">
            <div className="space-y-1 text-[12.5px]"><div className="flex items-center gap-2"><StatusDot status="good" />Good: {'≥'} comfortable path, or flush</div><div className="flex items-center gap-2"><StatusDot status="tight" />Tight: narrower than comfortable</div><div className="flex items-center gap-2"><StatusDot status="collision" />Collision, blocked door swing, or no room for the chair</div></div>
          </Section>
        </>
      )}

      {tab === 'view' && <ViewSettings />}
    </div>
  )
}

export function ViewSettings() {
  const { settings } = useScene()
  const set = useProject.getState().setSettings
  return (
    <>
      <Section title="Units">
        <Row label="Show lengths as"><Segmented size="sm" label="Units" value={settings.units} onChange={(v) => set({ units: v })} options={[{ value: 'in', label: 'Inches' }, { value: 'ftin', label: 'Feet + in' }]} /></Row>
        <Row label="Smallest fraction"><Select value={String(settings.precision)} width={90} onChange={(v) => set({ precision: Number(v) as 2 | 4 | 8 | 16 })} options={[{ value: '2', label: '1/2″' }, { value: '4', label: '1/4″' }, { value: '8', label: '1/8″' }, { value: '16', label: '1/16″' }]} /></Row>
      </Section>
      <Section title="Grid and snapping">
        <Row label="Grid"><Segmented size="sm" label="Grid" value={settings.gridSize} onChange={(v) => set({ gridSize: v })} options={[{ value: 0, label: 'Off' }, { value: 1, label: '1″' }, { value: 3, label: '3″' }, { value: 6, label: '6″' }, { value: 12, label: '12″' }]} /></Row>
        <Row label="Snapping" hint="Hold Alt/Option to bypass"><Switch label="Snapping" checked={settings.snapEnabled} onChange={(v) => set({ snapEnabled: v })} /></Row>
        <Row label="Snap to walls"><Switch label="Snap to walls" checked={settings.snapWalls} onChange={(v) => set({ snapWalls: v })} /></Row>
        <Row label="Snap to edges"><Switch label="Snap to furniture edges" checked={settings.snapEdges} onChange={(v) => set({ snapEdges: v })} /></Row>
        <Row label="Snap to centres"><Switch label="Snap to centres" checked={settings.snapCenters} onChange={(v) => set({ snapCenters: v })} /></Row>
        <Row label="Snap to grid"><Switch label="Snap to grid" checked={settings.snapGrid} onChange={(v) => set({ snapGrid: v })} /></Row>
        <Row label="Magnetic distance"><NumInput value={settings.snapThreshold} suffix="″" min={0} max={12} onCommit={(v) => set({ snapThreshold: v })} /></Row>
        <Row label="Rotation snap"><Segmented size="sm" label="Rotation snap" value={settings.rotationSnap} onChange={(v) => set({ rotationSnap: v })} options={[{ value: 0, label: 'Free' }, { value: 15, label: '15°' }, { value: 45, label: '45°' }, { value: 90, label: '90°' }]} /></Row>
      </Section>
      <Section title="Display">
        <Row label="Names"><Switch label="Show names" checked={settings.showNames} onChange={(v) => set({ showNames: v })} /></Row>
        <Row label="Clearance lines"><Switch label="Show clearance lines" checked={settings.showClearance} onChange={(v) => set({ showClearance: v })} /></Row>
        <Row label="Chair space"><Switch label="Show chair space" checked={settings.showChairZone} onChange={(v) => set({ showChairZone: v })} /></Row>
      </Section>
    </>
  )
}

