import type { FurnitureTemplate } from './types'
import type { LDeskShape } from '../geometry/shapes'

const t = (
  id: string,
  name: string,
  category: FurnitureTemplate['category'],
  width: number,
  depth: number,
  height: number,
  color: string,
  extra: Partial<FurnitureTemplate> = {},
): FurnitureTemplate => ({ id, name, category, width, depth, height, color, shape: { kind: 'rect' }, workSide: 'none', collides: true, ...extra })

/** The user's black L-shaped standing desk. Every dimension is editable. */
export const SEED_DESK_SHAPE: LDeskShape = {
  kind: 'ldesk',
  mainLength: 64,
  mainDepth: 24,
  returnLength: 43.5,
  returnWidth: 21,
  // The curved inside corner's radius has not been measured: this is a visual placeholder, editable in the inspector.
  innerRadius: 6,
  returnSide: 'left',
  returnMeasure: 'outer',
}

export const SEED_DESK_TEMPLATE: FurnitureTemplate = {
  id: 'tpl-my-l-desk',
  name: 'My L-shaped standing desk',
  category: 'Custom',
  width: 64,
  depth: 43.5,
  height: 29,
  shape: SEED_DESK_SHAPE,
  color: '#1d1d1f',
  workSide: 'ldesk',
  collides: true,
  custom: true,
}

/** Starter sizes are typical dimensions, not measurements of your furniture. Edit any of them. */
export const STARTER_LIBRARY: FurnitureTemplate[] = [
  t('tpl-desk', 'Desk', 'Office', 60, 30, 30, '#c8a27c', { workSide: 'front' }),
  t('tpl-l-desk', 'L-shaped desk', 'Office', 66, 48, 30, '#b88f68', {
    workSide: 'ldesk',
    shape: { kind: 'ldesk', mainLength: 66, mainDepth: 24, returnLength: 48, returnWidth: 22, innerRadius: 4, returnSide: 'left', returnMeasure: 'outer' },
  }),
  t('tpl-chair', 'Office chair', 'Office', 26, 26, 40, '#5b6470', { shape: { kind: 'ellipse' }, role: 'chair' }),
  t('tpl-filing', 'Filing cabinet', 'Office', 15, 25, 28, '#8e949c'),
  t('tpl-bookshelf', 'Bookshelf', 'Storage', 36, 12, 72, '#9c7a5b'),
  t('tpl-cabinet', 'Cabinet', 'Storage', 30, 18, 36, '#a58a6e'),
  t('tpl-dresser', 'Dresser', 'Bedroom', 60, 18, 32, '#b09274'),
  t('tpl-bed', 'Bed (queen)', 'Bedroom', 60, 80, 24, '#d8d3cb'),
  t('tpl-nightstand', 'Nightstand', 'Bedroom', 20, 16, 24, '#b09274'),
  t('tpl-couch', 'Couch', 'Living Room', 84, 36, 34, '#7d8a99'),
  t('tpl-armchair', 'Armchair', 'Living Room', 34, 34, 34, '#8a97a5'),
  t('tpl-table', 'Table', 'Living Room', 60, 36, 30, '#c2a07e'),
  t('tpl-coffee', 'Coffee table', 'Living Room', 48, 24, 18, '#b89674'),
  t('tpl-side', 'Side table', 'Living Room', 20, 20, 22, '#c2a07e', { shape: { kind: 'ellipse' } }),
  t('tpl-rug', 'Rug', 'Living Room', 96, 60, 0.5, '#d9d2c7', { collides: false }),
  t('tpl-lamp', 'Floor lamp', 'Lighting', 14, 14, 60, '#e8c76a', { shape: { kind: 'ellipse' } }),
  t('tpl-plant', 'Plant', 'Plants', 18, 18, 36, '#6fa57a', { shape: { kind: 'ellipse' } }),
  t('tpl-tv', 'TV (on stand)', 'Electronics', 44, 4, 27, '#2c2c2e'),
  t('tpl-tv-console', 'TV console', 'Electronics', 56, 16, 22, '#8d7457'),
]

export function allTemplates(custom: FurnitureTemplate[]): FurnitureTemplate[] {
  return [...STARTER_LIBRARY, ...custom]
}
