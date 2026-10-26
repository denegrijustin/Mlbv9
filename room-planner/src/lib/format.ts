import { formatLength, formatShort } from '../geometry/units'
import type { Settings } from '../model/types'

export const lengthFormatter = (s: Pick<Settings, 'units' | 'precision'>) => (inches: number) => formatLength(inches, { units: s.units, denom: s.precision })
export const shortFormatter = (s: Pick<Settings, 'units'>) => (inches: number) => formatShort(inches, s.units)
