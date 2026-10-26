import { useMemo } from 'react'
import { collisionMap } from '../engine/analysis'
import { resolveArchitecture } from '../engine/room'
import { lengthFormatter, shortFormatter } from '../lib/format'
import { selectActiveLayout, useProject } from '../store/project'

/** Derived scene data shared by the panels (the canvas builds the same values for itself). */
export function useScene() {
  const project = useProject((s) => s.project)
  const layout = useProject(selectActiveLayout)
  const { settings } = project
  const arch = useMemo(() => resolveArchitecture(project.room), [project.room])
  const ctx = useMemo(() => ({ arch, furniture: layout.furniture, settings: { rules: settings.rules } }), [arch, layout.furniture, settings.rules])
  const collisions = useMemo(() => collisionMap(ctx), [ctx])
  const fmt = useMemo(() => lengthFormatter(settings), [settings])
  const short = useMemo(() => shortFormatter(settings), [settings])
  return { project, layout, settings, arch, ctx, collisions, fmt, short }
}
