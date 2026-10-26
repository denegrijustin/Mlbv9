import { useEffect } from 'react'
import { PlanCanvas } from './canvas/PlanCanvas'
import { BottomSheet } from './ui/BottomSheet'
import { FitBadge, LayoutBar, SnapBar, Toast } from './ui/Floating'
import { useHotkeys } from './ui/hotkeys'
import { Inspector, ViewSettings } from './ui/Inspector'
import { Button, Icon, IconButton, type IconName } from './ui/kit'
import { LeftPanel } from './ui/LeftPanel'
import { ShapeEditorDialog } from './ui/ShapeEditor'
import { Toolbar } from './ui/Toolbar'
import { useIsMobile } from './ui/useMedia'
import { useProject } from './store/project'
import { useUi } from './store/ui'

export default function App() {
  useHotkeys()
  const mobile = useIsMobile()
  const hydrated = useProject((s) => s.hydrated)
  const presentation = useUi((s) => s.presentation)
  const sheet = useUi((s) => s.sheet)
  const setSheet = useUi((s) => s.setSheet)
  const selection = useUi((s) => s.selection)
  const mode = useUi((s) => s.mode)

  // On phones, selecting something opens its properties; deselecting closes the sheet.
  useEffect(() => {
    if (!mobile) return
    if (selection) setSheet('inspector')
    else if (useUi.getState().sheet === 'inspector') setSheet(null)
  }, [selection, mobile, setSheet])

  if (!hydrated) return <div className="fixed inset-0 flex items-center justify-center text-ink3">Loading…</div>

  const hudVisible = !presentation
  return (
    <div className="fixed inset-0 flex flex-col bg-bg text-ink" data-testid="app" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <Toolbar compact={mobile} />
      <div className="relative flex min-h-0 flex-1 gap-2.5 p-2.5 pt-2" style={mobile || presentation ? { padding: 0 } : undefined}>
        {!mobile && hudVisible && (
          <aside className="w-[284px] shrink-0 overflow-hidden rounded-2xl border border-line bg-solid shadow-panel" aria-label="Library">
            <LeftPanel />
          </aside>
        )}
        <main className={`relative min-w-0 flex-1 overflow-hidden bg-bg ${mobile || presentation ? '' : 'border border-line shadow-panel'}`} style={{ borderRadius: mobile || presentation ? 0 : 16 }}>
          <PlanCanvas />
          {hudVisible && (
            <>
              <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col items-start gap-2">
                <LayoutBar />
              </div>
              <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-center"><div className="mt-12 max-w-full sm:mt-0"><FitBadge /></div></div>
              <div className="pointer-events-none absolute inset-x-3 flex justify-center" style={{ bottom: mobile ? 72 : 14 }}>
                <SnapBar />
              </div>
              <div className="pointer-events-auto absolute right-3 top-3 flex flex-col gap-1 rounded-xl border border-line bg-[var(--panel)] p-0.5 shadow-panel backdrop-blur" style={mobile ? { top: 96 } : undefined}>
                <IconButton icon="zoomIn" label="Zoom in" size={32} onClick={() => useUi.getState().sendCanvasCmd('zoomIn')} />
                <IconButton icon="zoomOut" label="Zoom out" size={32} onClick={() => useUi.getState().sendCanvasCmd('zoomOut')} />
                <IconButton icon="fit" label="Fit room to screen" size={32} onClick={() => useUi.getState().sendCanvasCmd('fit')} />
                <IconButton icon="move" label="Center room (keeps zoom)" size={32} onClick={() => useUi.getState().sendCanvasCmd('center')} />
              </div>
            </>
          )}
          {presentation && (
            <div className="absolute right-4 top-4"><Button variant="secondary" icon="close" onClick={() => useUi.getState().setPresentation(false)}>Exit presentation</Button></div>
          )}
        </main>
        {!mobile && hudVisible && (
          <aside className="thin-scroll w-[316px] shrink-0 overflow-y-auto rounded-2xl border border-line bg-solid shadow-panel" aria-label="Properties" data-testid="inspector">
            <Inspector />
          </aside>
        )}
      </div>

      {mobile && !presentation && (
        <>
          <nav className="glass fixed inset-x-0 bottom-0 z-30 flex justify-around border-x-0 border-b-0 px-2 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5" aria-label="Panels">
            {([['library', mode === 'room' ? 'Room' : 'Furniture', mode === 'room' ? 'wall' : 'bookcase'], ['inspector', 'Properties', 'sliders'], ['settings', 'Settings', 'grid']] as Array<[string, string, IconName]>).map(([k, label, icon]) => (
              <button key={k} type="button" onClick={() => setSheet(sheet === k ? null : (k as 'library'))} className={`flex w-24 flex-col items-center gap-0.5 rounded-xl py-1 text-[11px] font-medium ${sheet === k ? 'text-accent' : 'text-ink2'}`}>
                <Icon name={icon} size={20} />
                {label}
              </button>
            ))}
          </nav>
          <BottomSheet open={sheet === 'library'} onClose={() => setSheet(null)} title={mode === 'room' ? 'Room' : 'Furniture'}><LeftPanel /></BottomSheet>
          <BottomSheet open={sheet === 'inspector'} onClose={() => { setSheet(null); useUi.getState().select(null) }} title="Properties"><Inspector /></BottomSheet>
          <BottomSheet open={sheet === 'settings'} onClose={() => setSheet(null)} title="Settings"><ViewSettings /></BottomSheet>
        </>
      )}
      <ShapeEditorDialog />
      <Toast />
    </div>
  )
}
