/** The seed as first shipped (only the 101" width known). Tests use it as a fixed baseline; the app's seed has since gained supplied values. */
import { createSeedProject, createSeedRoom } from './defaults'
import type { Pillar, Project, Room } from './types'

export function baselineSeedRoom(): Room {
  const r = createSeedRoom()
  r.depth = null
  for (const it of r.items) if (it.type === 'pillar') (it as Pillar).width = null
  return r
}

export function baselineSeedProject(): Project {
  const p = createSeedProject()
  p.room = baselineSeedRoom()
  return p
}
