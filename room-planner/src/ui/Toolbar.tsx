import { useEffect, useRef, useState, type ReactNode } from 'react'
import { selectActiveLayout, useProject } from '../store/project'
import { useSaveStatus } from '../store/persist'
import { useUi } from '../store/ui'
import { Button, Icon, IconButton, Segmented, TextInput } from './kit'
import { ViewSettings } from './Inspector'

export function Toolbar({ compact }: { compact: boolean }) {
  const mode = useUi((s) => s.mode)
  const setMode = useUi((s) => s.setMode)
  const zoom = useUi((s) => s.viewport.zoom)
  const cmd = useUi((s) => s.sendCanvasCmd)
  const past = useProject((s) => s.past.length)
  const future = useProject((s) => s.future.length)
  const name = useProject((s) => s.project.name)
  const layout = useProject(selectActiveLayout)
  const save = useSaveStatus((s) => s.status)
  const measureMode = useUi((s) => s.measureMode)
  const setMeasureMode = useUi((s) => s.setMeasureMode)
  const presentation = useUi((s) => s.presentation)

  if (presentation) return null

  return (
    <header className="glass z-30 flex h-[52px] shrink-0 items-center gap-2 border-x-0 border-t-0 px-3" role="banner">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-white"><Icon name="layers" size={16} /></div>
        {!compact && (
          <div className="min-w-0">
            <div className="w-[170px]"><TextInput value={name} onCommit={(v) => useProject.getState().renameProject(v || name)} className="!h-6 !bg-transparent !px-1 text-[14px] font-semibold focus:!bg-solid" /></div>
            <div className="px-1 text-[11px] text-ink3" aria-live="polite">{layout.name} · {save === 'saving' ? 'Saving…' : save === 'error' ? 'Not saved' : 'Saved on this device'}</div>
          </div>
        )}
      </div>

      <div className="mx-auto flex items-center gap-2">
        <Segmented label="Mode" value={mode} onChange={setMode} options={[{ value: 'room', label: 'Room' }, { value: 'furniture', label: 'Furniture' }, { value: 'measure', label: 'Measure' }]} />
        {mode === 'measure' && !compact && (
          <Segmented size="sm" label="Measure direction" value={measureMode} onChange={setMeasureMode} options={[{ value: 'free', label: 'Free' }, { value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }]} />
        )}
      </div>

      <div className="flex items-center gap-0.5">
        <IconButton icon="undo" label="Undo (Ctrl/Cmd+Z)" onClick={() => useProject.getState().undo()} disabled={past === 0} />
        <IconButton icon="redo" label="Redo (Shift+Ctrl/Cmd+Z)" onClick={() => useProject.getState().redo()} disabled={future === 0} />
        {!compact && (
          <>
            <div className="mx-1 h-5 w-px bg-[var(--line)]" />
            <IconButton icon="zoomOut" label="Zoom out" onClick={() => cmd('zoomOut')} />
            <button type="button" onClick={() => cmd('fit')} title="Fit room to screen" className="h-8 min-w-[52px] rounded-lg px-1 text-[12px] font-medium tabular-nums text-ink2 hover:bg-fill">{Math.round(zoom * 100) / 100}×</button>
            <IconButton icon="zoomIn" label="Zoom in" onClick={() => cmd('zoomIn')} />
            <IconButton icon="fit" label="Fit room to screen" onClick={() => cmd('fit')} />
            <div className="mx-1 h-5 w-px bg-[var(--line)]" />
            <Segmented size="sm" label="View" value="2d" onChange={() => undefined} options={[{ value: '2d', label: '2D' }, { value: '3d', label: '3D', disabled: true, title: '3D view arrives in Wave 3' }]} />
            <div className="mx-1 h-5 w-px bg-[var(--line)]" />
            <Button variant="secondary" icon="copy" title="Save this arrangement as a new layout" onClick={() => { useProject.getState().addLayout({ duplicate: true, name: `${layout.name} copy` }); useUi.getState().showToast('Saved as a new layout') }}>Save layout</Button>
          </>
        )}
        <ExportMenu />
      </div>
    </header>
  )
}

export function Popover({ trigger, content, align = 'right' }: { trigger: (toggle: () => void, open: boolean) => ReactNode; content: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const on = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', on)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', on)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      {trigger(() => setOpen((o) => !o), open)}
      {open && <div className={`pop absolute top-[38px] z-40 w-[280px] rounded-2xl border border-line bg-solid shadow-float ${align === 'right' ? 'right-0' : 'left-0'}`}>{content(() => setOpen(false))}</div>}
    </div>
  )
}

export function MenuItem({ icon, children, onClick, danger }: { icon: Parameters<typeof Icon>[0]['name']; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-fill ${danger ? 'text-bad' : ''}`}>
      <Icon name={icon} size={16} />
      {children}
    </button>
  )
}

function ExportMenu() {
  const fileRef = useRef<HTMLInputElement>(null)
  const toast = useUi((s) => s.showToast)
  const setPresentation = useUi((s) => s.setPresentation)
  return (
    <Popover
      trigger={(toggle, open) => <IconButton icon="more" label="Project menu" onClick={toggle} active={open} />}
      content={(close) => (
        <div className="p-1.5">
          <MenuItem icon="presentation" onClick={() => { close(); setPresentation(true) }}>Presentation mode</MenuItem>
          <MenuItem icon="image" onClick={async () => { close(); try { const { exportPng } = await import('../lib/exportFiles'); if (await exportPng(useProject.getState().project)) toast('PNG exported') } catch (e) { toast(e instanceof Error ? e.message : 'Export failed') } }}>Export PNG</MenuItem>
          <MenuItem icon="download" onClick={async () => { close(); const { exportSvg } = await import('../lib/exportFiles'); if (await exportSvg(useProject.getState().project)) toast('SVG exported') }}>Export SVG (vector)</MenuItem>
          <MenuItem icon="download" onClick={async () => { close(); const { exportJson } = await import('../lib/exportFiles'); if (await exportJson(useProject.getState().project)) toast('Project exported') }}>Export project (JSON)</MenuItem>
          <MenuItem icon="upload" onClick={() => fileRef.current?.click()}>Import project…</MenuItem>
          <div className="my-1 h-px bg-[var(--line)]" />
          <MenuItem icon="trash" danger onClick={() => { close(); useProject.getState().resetToSeed(); useUi.getState().select(null); toast('Reset to the sample office') }}>Reset to sample office</MenuItem>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="import-file"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              const { importJsonFile } = await import('../lib/exportFiles')
              const r = await importJsonFile(f)
              close()
              if (r.ok) {
                useProject.getState().loadProject(r.project)
                useUi.getState().select(null)
                useUi.getState().sendCanvasCmd('fit')
                toast(`Imported “${r.project.name}”`)
              } else toast(`Import failed: ${r.error}`)
            }}
          />
        </div>
      )}
    />
  )
}

export function SettingsPopover() {
  return (
    <Popover
      align="left"
      trigger={(toggle, open) => <IconButton icon="sliders" label="Settings" onClick={toggle} active={open} />}
      content={() => <div className="thin-scroll max-h-[70vh] overflow-y-auto"><ViewSettings /></div>}
    />
  )
}
