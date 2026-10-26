import { describe, expect, it } from 'vitest'
import { formatAngle, formatLength, parseLength } from './units'

describe('parseLength', () => {
  it('parses plain and decimal inches', () => {
    expect(parseLength('101')).toBe(101)
    expect(parseLength('101"')).toBe(101)
    expect(parseLength('88.5')).toBe(88.5)
    expect(parseLength('  64  ')).toBe(64)
    expect(parseLength('.5')).toBe(0.5)
  })
  it('parses fractions and mixed numbers', () => {
    expect(parseLength('1/2')).toBe(0.5)
    expect(parseLength('88 1/2')).toBe(88.5)
    expect(parseLength('88-1/2"')).toBe(88.5)
    expect(parseLength('43 1/2')).toBe(43.5)
    expect(parseLength('4½')).toBe(4.5)
    expect(parseLength('7¾"')).toBe(7.75)
  })
  it('parses feet and inches', () => {
    expect(parseLength("7'")).toBe(84)
    expect(parseLength("7' 4\"")).toBe(88)
    expect(parseLength("7'4")).toBe(88)
    expect(parseLength("7' 4 1/2\"")).toBe(88.5)
    expect(parseLength('7 ft 4 in')).toBe(88)
    expect(parseLength('7ft')).toBe(84)
    expect(parseLength("7′ 4½″")).toBe(88.5)
    expect(parseLength("0' 6\"")).toBe(6)
  })
  it('parses metric', () => {
    expect(parseLength('254cm')).toBeCloseTo(100, 6)
    expect(parseLength('25.4 mm')).toBeCloseTo(1, 6)
    expect(parseLength('2.54m')).toBeCloseTo(100, 6)
  })
  it('rejects garbage, empty text and zero denominators', () => {
    expect(parseLength('')).toBeNull()
    expect(parseLength('abc')).toBeNull()
    expect(parseLength('1/0')).toBeNull()
    expect(parseLength('12 x')).toBeNull()
    expect(parseLength("x' 4")).toBeNull()
    expect(parseLength('1..2')).toBeNull()
  })
  it('only allows negatives when asked', () => {
    expect(parseLength('-5')).toBeNull()
    expect(parseLength('-5', { allowNegative: true })).toBe(-5)
    expect(parseLength('-1/2', { allowNegative: true })).toBe(-0.5)
  })
})

describe('formatLength', () => {
  it('formats inches with fractions', () => {
    expect(formatLength(101)).toBe('101"')
    expect(formatLength(88.5)).toBe('88½"')
    expect(formatLength(43.5)).toBe('43½"')
    expect(formatLength(7.0625)).toBe('7 1/16"')
    expect(formatLength(0.5)).toBe('½"')
    expect(formatLength(0)).toBe('0"')
  })
  it('formats feet and inches', () => {
    expect(formatLength(88, { units: 'ftin' })).toBe(`7' 4"`)
    expect(formatLength(88.5, { units: 'ftin' })).toBe(`7' 4½"`)
    expect(formatLength(84, { units: 'ftin' })).toBe(`7'`)
    expect(formatLength(6, { units: 'ftin' })).toBe('6"')
    expect(formatLength(101, { units: 'ftin' })).toBe(`8' 5"`)
  })
  it('rounds to the requested denominator and carries correctly', () => {
    expect(formatLength(11.99, { units: 'ftin', denom: 8 })).toBe(`1'`)
    expect(formatLength(5.97, { denom: 8 })).toBe('6"')
    expect(formatLength(5.3, { denom: 4 })).toBe('5¼"')
  })
  it('supports ascii fractions and bare marks', () => {
    expect(formatLength(88.5, { glyphs: false })).toBe('88 1/2"')
    expect(formatLength(88.5, { bare: true })).toBe('88½')
  })
  it('handles negatives and invalid numbers', () => {
    expect(formatLength(-3.5)).toBe('-3½"')
    expect(formatLength(NaN)).toBe('—')
    expect(formatLength(-0.001)).toBe('0"')
  })
  it('round-trips parse(format(x)) at 1/16 precision', () => {
    for (const x of [0, 1, 13.5, 21, 24, 43.5, 64, 88.0625, 101, 143.9375]) {
      expect(parseLength(formatLength(x))).toBeCloseTo(x, 9)
      expect(parseLength(formatLength(x, { units: 'ftin' }))).toBeCloseTo(x, 9)
    }
  })
})

describe('formatAngle', () => {
  it('trims trailing zeros', () => {
    expect(formatAngle(90)).toBe('90°')
    expect(formatAngle(37.46)).toBe('37.5°')
  })
})
