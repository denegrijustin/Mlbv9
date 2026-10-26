import { useRef, useState } from 'react'
import { calibrate, loadReferenceFile } from '../lib/reference'
import { dist } from '../geometry/vec'
import { useProject } from '../store/project'
import { useUi } from '../store/ui'
import { Button, LengthInput, NumInput, Pill, Row, Section, Switch } from './kit'

/** A photo or drawing placed under the plan for tracing. It never supplies a dimension until it is calibrated. */
export function ReferenceSection() {
  const ref = useProject((s) => s.project.reference ?? null)
  const room = useProject((s) => s.project.room)
  const units = useProject((s) => s.project.settings.units)
  const calibrating = useUi((s) => s.calibrating)
  const refEdit = useUi((s) => s.refEdit)
  const fileRef = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const [real, setReal] = useState<number | null>(null)
  const store = useProject.getState
  const ui = useUi.getState

  const pick = async (f: File | undefined) => {
    if (!f) return
    try {
      setErr(null)
      store().setReference(await loadReferenceFile(f, { room }))
      ui().showToast('Photo added — calibrate it before relying on its scale')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add the photo')
    }
  }
  const input = (
    <input ref={fileRef} type="file" accept="image/*" className="hidden" data-testid="ref-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f) }} />
  )

  if (!ref) {
    return (
      <Section title="Reference photo">
        <div className="text-[12px] text-ink2">Trace over a photo or sketch of the room. It sits under the plan and is never used to guess a measurement.</div>
        <div className="mt-2"><Button icon="image" onClick={() => fileRef.current?.click()}>Add a photo</Button></div>
        {input}
        {err && <div className="mt-2 rounded-lg bg-warnsoft p-2 text-[12px] text-warn" role="alert">{err}</div>}
      </Section>
    )
  }

  const ready = calibrating && calibrating.points.length === 2
  const pxApart = ready ? dist(calibrating!.points[0], calibrating!.points[1]) : 0
  const apply = () => {
    if (!ready || real === null || real <= 0) return
    store().updateReference(calibrate(ref, calibrating!.points[0], pxApart / ref.inchesPerPixel, real))
    ui().setCalibrating(null)
    setReal(null)
    ui().showToast('Photo calibrated')
  }
  const set = store().updateReference

  return (
    <Section title="Reference photo" action={ref.calibrated ? <Pill tone="good">Calibrated</Pill> : <Pill tone="warn">Not to scale</Pill>}>
      <div className="truncate text-[13px] font-medium" title={ref.name}>{ref.name}</div>
      {!ref.calibrated && <div className="mt-1 text-[12px] text-ink2">The size shown is a placeholder. Calibrate it against a distance you measured in the room.</div>}
      <div className="mt-2">
        <Row label="Show"><Switch label="Show photo" checked={ref.visible} onChange={(v) => set({ visible: v })} /></Row>
        <Row label="Opacity"><input type="range" min={0.1} max={1} step={0.05} value={ref.opacity} aria-label="Photo opacity" onChange={(e) => set({ opacity: Number(e.target.value) })} className="w-[110px]" /></Row>
        <Row label="Rotation"><NumInput value={ref.rotation} suffix="°" min={-180} max={180} step={0.5} onCommit={(v) => set({ rotation: v })} /></Row>
        <Row label="Lock position"><Switch label="Lock photo" checked={ref.locked} onChange={(v) => { set({ locked: v }); if (v) ui().setRefEdit(false) }} /></Row>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button icon="move" variant={refEdit ? 'primary' : 'secondary'} disabled={ref.locked} onClick={() => ui().setRefEdit(!refEdit)}>{refEdit ? 'Done moving' : 'Move photo'}</Button>
        <Button icon="ruler" variant={calibrating ? 'primary' : 'secondary'} onClick={() => ui().setCalibrating(calibrating ? null : { points: [] })} data-testid="ref-calibrate">{calibrating ? 'Cancel' : 'Calibrate scale'}</Button>
      </div>
      {calibrating && (
        <div className="mt-2 rounded-xl bg-accentsoft p-2.5 text-[12px] text-accent">
          {calibrating.points.length < 2 ? `Click point ${calibrating.points.length === 0 ? 'A' : 'B'} on the photo — two features whose real distance you know.` : 'Now type the real distance between A and B.'}
          {ready && (
            <div className="mt-2 flex items-center gap-2 text-ink">
              <LengthInput units={units} value={real} nullable min={0.5} width={110} placeholder="Real distance" onCommit={setReal} testId="ref-real" />
              <Button variant="primary" disabled={real === null || real <= 0} onClick={apply}>Apply</Button>
            </div>
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button variant="ghost" icon="image" onClick={() => fileRef.current?.click()}>Replace</Button>
        <Button variant="ghost" icon="trash" onClick={() => { store().setReference(null); ui().setRefEdit(false); ui().setCalibrating(null) }}>Remove</Button>
      </div>
      {input}
      {err && <div className="mt-2 rounded-lg bg-warnsoft p-2 text-[12px] text-warn" role="alert">{err}</div>}
      <div className="mt-2 text-[11px] text-ink3">Scale: {Math.round(ref.inchesPerPixel * 1000) / 1000}″ per image pixel{ref.calibrated ? '' : ' (placeholder)'}.</div>
    </Section>
  )
}
