import { useEffect } from 'react'
import { selectActiveLayout, useProject } from '../store/project'
import { useUi } from '../store/ui'

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState()
      const proj = useProject.getState()
      if (e.key === 'Alt') ui.setSnapSuspended(true)
      if (isTyping(e.target) || ui.shapeEditor) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()

      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) proj.redo()
        else proj.undo()
        return
      }
      if (mod && key === 'y') {
        e.preventDefault()
        proj.redo()
        return
      }
      const sel = ui.selection
      const layout = selectActiveLayout(proj)
      const f = sel?.kind === 'furniture' ? layout.furniture.find((x) => x.id === sel.id) : undefined

      if (mod && key === 'd' && f) {
        e.preventDefault()
        const id = proj.duplicateFurniture(f.id)
        if (id) ui.select({ kind: 'furniture', id })
        return
      }
      if (mod || e.altKey && key !== 'arrowleft' && key !== 'arrowright' && key !== 'arrowup' && key !== 'arrowdown') return

      if (e.key === 'Escape') {
        if (ui.wallDraft || ui.measureDraft) {
          ui.setWallDraft(null)
          ui.setMeasureDraft(null)
        } else if (ui.wallTool) ui.setWallTool(false)
        else if (ui.presentation) ui.setPresentation(false)
        else ui.select(null)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault()
        if (f) {
          proj.removeFurniture([f.id])
          ui.select(null)
        } else if (sel.kind === 'wall') {
          const w = proj.project.room.interiorWalls.find((x) => x.id === sel.id)
          if (w && !w.locked) {
            proj.removeInteriorWall(w.id)
            ui.select(null)
          }
        } else if (sel.kind === 'arch') {
          const a = proj.project.room.items.find((x) => x.id === sel.id)
          if (a && !a.locked) {
            proj.removeArch(a.id)
            ui.select(null)
          } else ui.showToast('Unlock it first (it is locked so it cannot be removed by accident)')
        }
        return
      }
      if (key === 'r' && f && !f.locked) {
        proj.rotateFurniture(f.id, e.shiftKey ? -90 : 90)
        return
      }
      if (key === 'l' && f) {
        proj.updateFurniture(f.id, { locked: !f.locked })
        return
      }
      if (key === 'f') {
        ui.sendCanvasCmd('fit')
        return
      }
      if (key === 'c') {
        ui.sendCanvasCmd('center')
        return
      }
      if (/^[1-9]$/.test(e.key)) {
        const l = proj.project.layouts[Number(e.key) - 1]
        if (l) proj.setActiveLayout(l.id)
        return
      }
      if (f && !f.locked && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 6 : e.altKey ? 0.125 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        proj.commit((d) => {
          const l = d.layouts.find((x) => x.id === d.activeLayoutId) ?? d.layouts[0]
          const t = l.furniture.find((x) => x.id === f.id)
          if (t) {
            t.x = Math.round((t.x + dx) * 10000) / 10000
            t.y = Math.round((t.y + dy) * 10000) / 10000
          }
        }, `nudge-${f.id}`)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') useUi.getState().setSnapSuspended(false)
    }
    const onBlur = () => useUi.getState().setSnapSuspended(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}
