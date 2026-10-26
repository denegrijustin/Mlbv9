import { useEffect, useState } from 'react'
import type { ClearanceStatus } from '../engine/clearance'

/** Concrete colours for SVG (so the same scene renders on screen and in a standalone PNG export). */
export interface Theme {
  dark: boolean
  bg: string
  floor: string
  floorEdge: string
  grid: string
  gridMajor: string
  wall: string
  wallInterior: string
  ink: string
  ink2: string
  ink3: string
  accent: string
  good: string
  warn: string
  bad: string
  wood: string
  woodStroke: string
  glass: string
  swing: string
  guide: string
  chip: string
  chipInk: string
  unmeasured: string
}

export const LIGHT: Theme = {
  dark: false,
  bg: '#f5f5f7',
  floor: '#ece7df',
  floorEdge: '#d9d2c6',
  grid: 'rgba(60,50,40,0.10)',
  gridMajor: 'rgba(60,50,40,0.20)',
  wall: '#48484a',
  wallInterior: '#636366',
  ink: '#1d1d1f',
  ink2: '#6e6e73',
  ink3: '#a1a1a6',
  accent: '#0071e3',
  good: '#1f9d4c',
  warn: '#d98200',
  bad: '#d92d20',
  wood: '#b78a62',
  woodStroke: '#7d5a3c',
  glass: '#cfe6f7',
  swing: 'rgba(0,113,227,0.10)',
  guide: '#e5338d',
  chip: 'rgba(255,255,255,0.96)',
  chipInk: '#1d1d1f',
  unmeasured: '#ff9f0a',
}

export const DARK: Theme = {
  dark: true,
  bg: '#101012',
  floor: '#4a443c',
  floorEdge: '#5a5348',
  grid: 'rgba(255,240,220,0.10)',
  gridMajor: 'rgba(255,240,220,0.20)',
  wall: '#8e8e93',
  wallInterior: '#6e6e73',
  ink: '#f5f5f7',
  ink2: '#a1a1a6',
  ink3: '#6e6e73',
  accent: '#4da3ff',
  good: '#4cd17a',
  warn: '#ffb340',
  bad: '#ff6a5f',
  wood: '#8c6a4a',
  woodStroke: '#c49a72',
  glass: '#2c4a62',
  swing: 'rgba(77,163,255,0.14)',
  guide: '#ff5fa8',
  chip: 'rgba(40,40,44,0.96)',
  chipInk: '#f5f5f7',
  unmeasured: '#ffb340',
}

function prefersDark(): boolean {
  if (typeof document === 'undefined') return false
  const forced = document.documentElement.dataset.theme
  if (forced === 'dark') return true
  if (forced === 'light') return false
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Follows an explicit data-theme choice on the root element, otherwise the system setting. */
export function useTheme(): Theme {
  const [dark, setDark] = useState(prefersDark)
  useEffect(() => {
    const update = () => setDark(prefersDark())
    const q = window.matchMedia?.('(prefers-color-scheme: dark)')
    q?.addEventListener('change', update)
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    update()
    return () => {
      q?.removeEventListener('change', update)
      mo.disconnect()
    }
  }, [])
  return dark ? DARK : LIGHT
}

export function statusColor(t: Theme, s: ClearanceStatus): string {
  return s === 'collision' ? t.bad : s === 'tight' ? t.warn : t.good
}
