/**
 * Length parsing and formatting. All stored values are inches (possibly fractional).
 * Parsing accepts: 101, 101", 88.5, 88 1/2, 88-1/2, 7' 4 1/2", 7'4, 7 ft 4 in, 4½, 1/2, 257cm, 2.6m.
 */

export type UnitSystem = 'in' | 'ftin'

const UNICODE_FRACTIONS: Record<string, string> = {
  '½': '1/2',
  '¼': '1/4',
  '¾': '3/4',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
  '⅙': '1/6',
  '⅓': '1/3',
  '⅔': '2/3',
}

const FRACTION_GLYPHS: Record<string, string> = {
  '1/2': '½',
  '1/4': '¼',
  '3/4': '¾',
  '1/8': '⅛',
  '3/8': '⅜',
  '5/8': '⅝',
  '7/8': '⅞',
}

function parseInches(expr: string): number | null {
  const s = expr.trim()
  if (s === '') return 0
  // N, N.N
  let m = /^(\d+(?:\.\d+)?|\.\d+)$/.exec(s)
  if (m) return parseFloat(m[1])
  // a/b
  m = /^(\d+)\s*\/\s*(\d+)$/.exec(s)
  if (m) {
    const den = parseInt(m[2], 10)
    return den === 0 ? null : parseInt(m[1], 10) / den
  }
  // N a/b  or  N-a/b
  m = /^(\d+)\s*[\s-]\s*(\d+)\s*\/\s*(\d+)$/.exec(s)
  if (m) {
    const den = parseInt(m[3], 10)
    return den === 0 ? null : parseInt(m[1], 10) + parseInt(m[2], 10) / den
  }
  return null
}

/** Returns inches, or null when the text is not a valid length. Empty text is null too. */
export function parseLength(input: string, opts: { allowNegative?: boolean } = {}): number | null {
  let s = input.trim().toLowerCase()
  if (s === '') return null
  for (const [glyph, ascii] of Object.entries(UNICODE_FRACTIONS)) s = s.split(glyph).join(' ' + ascii)
  s = s
    .replace(/[′’‘]/g, "'")
    .replace(/[″”“]/g, '"')
    .replace(/(?<![a-z])(feet|foot|ft)(?![a-z])/g, "'")
    .replace(/(?<![a-z])(inches|inch|in)(?![a-z])/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

  let negative = false
  if (s.startsWith('-')) {
    negative = true
    s = s.slice(1).trim()
  }

  let value: number | null = null

  const metric = /^(\d+(?:\.\d+)?|\.\d+)\s*(mm|cm|m)$/.exec(s)
  if (metric) {
    const n = parseFloat(metric[1])
    const perUnit = metric[2] === 'mm' ? 1 / 25.4 : metric[2] === 'cm' ? 1 / 2.54 : 100 / 2.54
    value = n * perUnit
  } else if (s.includes("'")) {
    const idx = s.indexOf("'")
    const feetText = s.slice(0, idx).trim()
    const restText = s.slice(idx + 1).replace(/"$/, '').trim()
    if (!/^(\d+(?:\.\d+)?|\.\d+)$/.test(feetText)) return null
    const inches = parseInches(restText)
    if (inches === null) return null
    value = parseFloat(feetText) * 12 + inches
  } else {
    value = parseInches(s.replace(/"$/, ''))
  }

  if (value === null || !Number.isFinite(value)) return null
  if (negative) {
    if (!opts.allowNegative) return null
    value = -value
  }
  return value
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

function fractionText(num: number, den: number, glyphs: boolean): { text: string; glyph: boolean } {
  const g = gcd(num, den)
  const key = `${num / g}/${den / g}`
  return glyphs && FRACTION_GLYPHS[key] ? { text: FRACTION_GLYPHS[key], glyph: true } : { text: key, glyph: false }
}

export interface FormatOptions {
  units?: UnitSystem
  /** Smallest fraction shown: 2, 4, 8 or 16 (1/2" ... 1/16"). */
  denom?: 2 | 4 | 8 | 16
  /** Use ½ ¼ ¾ glyphs where available. */
  glyphs?: boolean
  /** Omit the trailing inch mark (useful for tight chips). */
  bare?: boolean
}

/** Whole inches + fraction text for a non-negative inch value that is already rounded to 1/denom. */
function inchBody(value: number, denom: number, glyphs: boolean): string {
  const whole = Math.floor(value + 1e-9)
  const num = Math.round((value - whole) * denom)
  if (num === 0) return String(whole)
  const frac = fractionText(num, denom, glyphs)
  if (whole === 0) return frac.text
  return frac.glyph ? `${whole}${frac.text}` : `${whole} ${frac.text}`
}

export function formatLength(inches: number, opts: FormatOptions = {}): string {
  const { units = 'in', denom = 16, glyphs = true, bare = false } = opts
  if (!Number.isFinite(inches)) return '—'
  const rounded = Math.round(Math.abs(inches) * denom) / denom
  const sign = inches < 0 && rounded > 0 ? '-' : ''
  const mark = bare ? '' : '"'
  if (units === 'in') {
    return `${sign}${inchBody(rounded, denom, glyphs)}${mark}`
  }
  const feet = Math.floor(rounded / 12 + 1e-9)
  const rem = Math.round((rounded - feet * 12) * denom) / denom
  if (feet === 0) return `${sign}${inchBody(rem, denom, glyphs)}${mark}`
  if (rem === 0) return `${sign}${feet}'`
  return `${sign}${feet}' ${inchBody(rem, denom, glyphs)}${mark}`
}

/** Compact label for dimension lines: 1/8" precision. */
export function formatShort(inches: number, units: UnitSystem = 'in'): string {
  return formatLength(inches, { units, denom: 8 })
}

export function formatAngle(deg: number): string {
  const r = Math.round(deg * 10) / 10
  return `${Number.isInteger(r) ? r : r.toFixed(1)}°`
}
