import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import { create } from 'zustand'
import { validateProject } from '../model/serialize'
import type { Project } from '../model/types'
import { useProject } from './project'

const KEY = 'room-planner:project:v1'
const DEBOUNCE_MS = 500

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
export const useSaveStatus = create<{ status: SaveStatus; message?: string }>(() => ({ status: 'idle' }))

export async function loadSaved(): Promise<Project | null> {
  try {
    const raw = await idbGet(KEY)
    if (!raw) return null
    const r = validateProject(raw)
    return r.ok ? r.project : null
  } catch {
    return null
  }
}

export async function clearSaved(): Promise<void> {
  try {
    await idbDel(KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Load the last saved project (if any), then autosave every change. Storage failures (private windows, blocked
 * site data) are reported in the UI but never stop the app from working.
 */
export async function initPersistence(): Promise<void> {
  const saved = await loadSaved()
  if (saved) useProject.getState().loadProject(saved)
  else useProject.setState({ hydrated: true })

  let timer: ReturnType<typeof setTimeout> | undefined
  let last = useProject.getState().project
  useProject.subscribe((s) => {
    if (s.project === last) return
    last = s.project
    useSaveStatus.setState({ status: 'saving' })
    clearTimeout(timer)
    timer = setTimeout(async () => {
      try {
        await idbSet(KEY, useProject.getState().project)
        useSaveStatus.setState({ status: 'saved', message: undefined })
      } catch (e) {
        useSaveStatus.setState({ status: 'error', message: e instanceof Error ? e.message : 'Could not save locally' })
      }
    }, DEBOUNCE_MS)
  })
}
