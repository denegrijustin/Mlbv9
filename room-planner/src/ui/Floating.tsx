import { useMemo, useState } from 'react'
import { analyseFurniture } from '../engine/analysis'
import { useProject } from '../store/project'
import { useUi } from '../store/ui'
import { Icon, IconButton, Pill, Segmented, StatusDot, TextInput } from './kit'
import { MenuItem, Popover } from './Toolbar'
import { useScene } from './useScene'

/** Layout tabs (Layout A / B / C), with duplicate, rename, delete and a faint overlay of another layout for comparing. */
export function LayoutBar() {
  const { project } = useScene()
  const ghost = useUi((s) => s.ghostLayoutId)
  const setGhost = useUi((s) => s.setGhost)
  const store = useProject.getState
  const [renaming, setRenaming] = useState<string | null>(null)
  const active = project.layouts.find((l) => l.id === project.activeLayoutId)!
  const toast = useUi((s) => s.showToast)
  return (
    <div className="glass pointer-events-auto flex max-w-full items-center gap-1 rounded-full p-1 shadow-panel" role="tablist" aria-label="Layouts">
      <div className="thin-scroll flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {project.layouts.map((l, i) => (
          <div key={l.id} className="shrink-0">
            {renaming === l.id ? (
              <div className="w-[120px]"><TextInput value={l.name} onCommit={(v) => { store().renameLayout(l.id, v || l.name); setRenaming(null) }} /></div>
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={l.id === active.id}
                title={`${l.name} (press ${i + 1})`}
                onClick={() => store().setActiveLayout(l.id)}
                onDoubleClick={() => setRenaming(l.id)}
                className={`h-7 rounded-full px-3 text-[12.5px] font-medium transition ${l.id === active.id ? 'bg-accent text-white' : 'text-ink2 hover:bg-fill'}`}
              >
                {l.name}
              </button>
            )}
          </div>
        ))}
      </div>
      <IconButton icon="plus" label="New empty layout" size={28} onClick={() => store().addLayout()} />
      <Popover
        align="left"
        trigger={(toggle, open) => <IconButton icon="more" label="Layout options" size={28} onClick={toggle} active={open} />}
        content={(close) => (
          <div className="p-1.5">
            <MenuItem icon="copy" onClick={() => { close(); store().addLayout({ duplicate: true, name: `${active.name} copy` }); toast('Layout duplicated') }}>Duplicate “{active.name}”</MenuItem>
            <MenuItem icon="sliders" onClick={() => { close(); setRenaming(active.id) }}>Rename</MenuItem>
            <MenuItem icon="trash" danger onClick={() => { close(); if (project.layouts.length > 1) { store().deleteLayout(active.id); toast('Layout deleted (undo with Ctrl/Cmd+Z)') } else toast('A project needs at least one layout') }}>Delete layout</MenuItem>
            <div className="my-1 h-px bg-[var(--line)]" />
            <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink3">Compare: show behind this layout</div>
            <MenuItem icon="eyeOff" onClick={() => { close(); setGhost(null) }}>{ghost === null ? '✓ ' : ''}Nothing</MenuItem>
            {project.layouts.filter((l) => l.id !== active.id).map((l) => (
              <MenuItem key={l.id} icon="layers" onClick={() => { close(); setGhost(l.id) }}>{ghost === l.id ? '✓ ' : ''}{l.name}</MenuItem>
            ))}
          </div>
        )}
      />
      {ghost && <Pill tone="accent">comparing</Pill>}
    </div>
  )
}

/** Bottom-centre quick controls: snapping, grid, rotation snap, collision mode. */
export function SnapBar() {
  const { settings } = useScene()
  const set = useProject.getState().setSettings
  const suspended = useUi((s) => s.snapSuspended)
  return (
    <div className="glass pointer-events-auto flex items-center gap-1.5 rounded-full p-1 pl-1.5 shadow-panel">
      <IconButton icon="magnet" label={settings.snapEnabled ? 'Snapping on (hold Alt/Option to bypass)' : 'Snapping off'} active={settings.snapEnabled && !suspended} onClick={() => set({ snapEnabled: !settings.snapEnabled })} size={30} />
      <Segmented size="sm" label="Grid" value={settings.gridSize} onChange={(v) => set({ gridSize: v })} options={[{ value: 0, label: 'Off', title: 'Grid off' }, { value: 1, label: '1″' }, { value: 3, label: '3″' }, { value: 6, label: '6″' }, { value: 12, label: '12″' }]} />
      <div className="hidden h-5 w-px bg-[var(--line)] sm:block" />
      <div className="hidden sm:block"><Segmented size="sm" label="Rotation snap" value={settings.rotationSnap} onChange={(v) => set({ rotationSnap: v })} options={[{ value: 0, label: 'Free', title: 'Free rotation' }, { value: 15, label: '15°' }, { value: 45, label: '45°' }, { value: 90, label: '90°' }]} /></div>
      <div className="hidden h-5 w-px bg-[var(--line)] md:block" />
      <div className="hidden md:block"><Segmented size="sm" label="Collisions" value={settings.collisionMode} onChange={(v) => set({ collisionMode: v })} options={[{ value: 'warn', label: 'Warn', title: 'Allow overlap and outline it' }, { value: 'prevent', label: 'Block', title: 'Stop pieces from overlapping' }]} /></div>
      {suspended && <Pill tone="warn">snapping off</Pill>}
    </div>
  )
}

/** The at-a-glance answer to "will this fit here?" for the selected furniture, or what is still unmeasured. */
export function FitBadge() {
  const { layout, ctx, arch, fmt } = useScene()
  const selection = useUi((s) => s.selection)
  const setMode = useUi((s) => s.setMode)
  const item = selection?.kind === 'furniture' ? layout.furniture.find((f) => f.id === selection.id) : null
  const a = useMemo(() => (item && !item.hidden ? analyseFurniture(item, ctx) : null), [item, ctx])
  if (item && a) {
    const tone = a.status === 'collision' ? 'var(--bad)' : a.status === 'tight' ? 'var(--warn)' : 'var(--good)'
    const text = a.status === 'collision' ? (a.collisions.length ? `Doesn’t fit — overlaps ${a.collisions.map((c) => c.label).join(', ')}` : 'No room for the chair') : a.status === 'tight' ? 'Fits — chair space is tight' : 'Fits here'
    return (
      <div className="glass pointer-events-auto flex max-w-full items-center gap-2.5 rounded-full px-3.5 py-1.5 text-[12.5px] shadow-panel" data-testid="fit-badge" style={{ borderColor: tone }}>
        <StatusDot status={a.status} />
        <span className="truncate font-semibold" style={{ color: tone }}>{text}</span>
        {a.nearestWall && <span className="hidden whitespace-nowrap text-ink2 sm:inline">· {fmt(a.nearestWall.distance)} to {a.nearestWall.label.toLowerCase()}</span>}
        {a.chairZone && a.status !== 'collision' && <span className="hidden whitespace-nowrap text-ink2 md:inline">· chair {a.chairZone.free >= a.chairZone.required - 1e-6 ? `${fmt(a.chairZone.required)}+` : fmt(a.chairZone.free)}</span>}
      </div>
    )
  }
  const errors = arch.issues.filter((i) => i.severity === 'error').length
  const open = arch.unresolved.filter((u) => u.missing.length).length
  if (errors > 0) {
    return (
      <button type="button" onClick={() => { setMode('room'); useUi.getState().select(null) }} className="glass pointer-events-auto flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-bad shadow-panel" data-testid="conflict-badge">
        <Icon name="warning" size={15} /> {errors} measurement conflict{errors > 1 ? 's' : ''}
      </button>
    )
  }
  if (open > 0) {
    return (
      <button type="button" onClick={() => { setMode('room'); useUi.getState().select(null) }} className="glass pointer-events-auto flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold shadow-panel" style={{ color: 'var(--warn)' }} data-testid="unresolved-badge">
        <Icon name="ruler" size={15} /> {open} item{open > 1 ? 's' : ''} need{open > 1 ? '' : 's'} measurements
      </button>
    )
  }
  return null
}

export function Toast() {
  const toast = useUi((s) => s.toast)
  const show = useUi((s) => s.showToast)
  if (toast) setTimeout(() => useUi.getState().toast === toast && show(null), 2600)
  if (!toast) return null
  return (
    <div className="pop pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center" role="status">
      <div className="rounded-full bg-[#1d1d1f] px-4 py-2 text-[13px] font-medium text-white shadow-float">{toast}</div>
    </div>
  )
}
