import { useState } from 'react'
import { area } from '../geometry/polygon'
import { edgeIndex } from '../model/outlineEdit'
import { useProject } from '../store/project'
import { useUi } from '../store/ui'
import { Button, IconButton, LengthInput, Row, Section, Select } from './kit'
import { IssueList, Header } from './Inspector'
import { useScene } from './useScene'

/** Room shape: the measured rectangle, or a custom outline with editable corners. */
export function ShapeSection() {
  const { project, settings, arch, fmt } = useScene()
  const units = settings.units
  const store = useProject.getState
  const room = project.room
  const outline = room.outline
  const [err, setErr] = useState<string | null>(null)
  const [corner, setCorner] = useState('0')
  const [na, setNa] = useState<number | null>(null)
  const [nb, setNb] = useState<number | null>(null)

  if (!outline) {
    return (
      <Section title="Shape">
        <div className="text-[12px] text-ink2">Rectangle. Use a custom outline for L-shaped rooms, alcoves, bays and angled walls.</div>
        <div className="mt-2"><Button icon="wall" data-testid="to-outline" onClick={() => setErr(store().convertToOutline())}>Edit as custom shape</Button></div>
        {err && <div className="mt-2 rounded-lg bg-warnsoft p-2 text-[12px] text-warn" role="alert">{err}</div>}
      </Section>
    )
  }
  const floor = area(arch.room.polygon)
  const cornerOptions = outline.map((_, i) => ({ value: String(i), label: `Corner ${i + 1}` }))
  return (
    <Section title="Shape" action={<span className="text-[11px] tabular-nums text-ink3">{Math.round(floor / 144 * 10) / 10} sq ft</span>}>
      <div className="mb-2 text-[12px] text-ink2" data-testid="outline-summary">Custom outline · {outline.length} corners · overall {fmt(arch.room.width ?? 0)} × {fmt(arch.room.depth ?? 0)}. Drag a corner on the plan, or type its position (measured from the north-west of the overall bounding box).</div>
      {arch.issues.some((i) => i.id.startsWith('outline-')) && <div className="mb-2"><IssueList issues={arch.issues.filter((i) => i.id.startsWith('outline-'))} /></div>}
      <div className="space-y-1.5" data-testid="corner-list">
        {outline.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[12px]">
            <span className="w-14 shrink-0 text-ink2">Corner {i + 1}</span>
            <LengthInput units={units} value={p.x} min={-9999} width={72} onCommit={(v) => v !== null && store().setCorner(i, { x: v, y: p.y })} />
            <LengthInput units={units} value={p.y} min={-9999} width={72} onCommit={(v) => v !== null && store().setCorner(i, { x: p.x, y: v })} />
            <IconButton icon="close" label={`Remove corner ${i + 1}`} size={26} disabled={outline.length <= 3} onClick={() => store().removeCorner(i)} />
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-xl bg-fill p-2.5">
        <div className="mb-1.5 text-[12px] font-medium">Cut out a corner</div>
        <Row label="Corner"><Select value={corner} width={110} onChange={setCorner} options={cornerOptions} /></Row>
        <Row label="Along arriving wall"><LengthInput units={units} value={na} nullable min={0.5} width={88} placeholder="inches" onCommit={setNa} /></Row>
        <Row label="Along leaving wall"><LengthInput units={units} value={nb} nullable min={0.5} width={88} placeholder="inches" onCommit={setNb} /></Row>
        <Button icon="plus" disabled={na === null || nb === null} onClick={() => setErr(store().cutCorner(Number(corner), na!, nb!))}>Cut out</Button>
      </div>
      {err && <div className="mt-2 rounded-lg bg-warnsoft p-2 text-[12px] text-warn" role="alert">{err}</div>}
      <div className="mt-2"><Button variant="ghost" icon="undo" onClick={() => { store().revertToRectangle(); setErr(null) }}>Back to a rectangle</Button></div>
    </Section>
  )
}

/** Inspector for one wall of a custom outline. */
export function EdgeWallInspector({ id }: { id: string }) {
  const { project, settings, arch } = useScene()
  const select = useUi((s) => s.select)
  const store = useProject.getState
  const i = edgeIndex(id)
  const outline = project.room.outline
  const w = arch.room.wallById.get(id)
  if (i === null || !outline || !w) return null
  const issues = arch.issues.filter((x) => x.itemIds.includes(id))
  const end = outline[(i + 1) % outline.length]
  const start = outline[i]
  return (
    <div className="pop">
      <Header title={w.name} subtitle={`Perimeter wall · corner ${i + 1} to corner ${((i + 1) % outline.length) + 1}`} onClose={() => select(null)} />
      <Section title="Length">
        <Row label="Wall length" hint="Moves the far corner"><LengthInput units={settings.units} value={w.length} min={1} onCommit={(v) => {
          if (v === null || !w.length) return
          store().setCorner((i + 1) % outline.length, { x: start.x + w.dir.x * v, y: start.y + w.dir.y * v })
        }} testId="wall-length" /></Row>
        <div className="mt-1 text-[12px] text-ink3">Inside surface to inside surface. Moving the far corner also changes the next wall.</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button icon="plus" onClick={() => store().insertCorner(i)}>Add a corner here</Button>
        </div>
        <div className="mt-1 text-[11px] text-ink3">Far corner is at {Math.round(end.x * 100) / 100}″, {Math.round(end.y * 100) / 100}″.</div>
      </Section>
      {issues.length > 0 && <Section title="Conflicts"><IssueList issues={issues} /></Section>}
    </div>
  )
}
