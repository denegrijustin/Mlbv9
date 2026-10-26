import { describe, expect, it } from 'vitest'
import { PdfBuilder, pdfText, textWidth } from './pdf'

const decode = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('')

describe('pdf writer', () => {
  it('writes a well-formed file whose xref offsets point at the objects', () => {
    const pdf = new PdfBuilder()
    pdf.setTitle('Office (draft)')
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const id = pdf.addJpeg(jpeg, 1, 1)
    pdf.addPage(612, 792, (p) => {
      p.text(36, 750, 'Office Layout - 101" wide', { bold: true, size: 18 })
      p.line(36, 740, 576, 740)
      p.image(id, 36, 400, 300, 300)
    })
    pdf.addPage(612, 792, (p) => p.text(36, 750, 'Schedule'))
    const s = decode(pdf.build())
    expect(s.startsWith('%PDF-1.4')).toBe(true)
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true)
    const start = Number(/startxref\n(\d+)/.exec(s)![1])
    expect(s.slice(start, start + 4)).toBe('xref')
    const entries = s.slice(start).split('\n').slice(3).filter((l) => /^\d{10} 00000 n/.test(l))
    entries.forEach((e, i) => {
      const off = Number(e.slice(0, 10))
      expect(s.slice(off, off + String(i + 1).length + 6)).toBe(`${i + 1} 0 obj`)
    })
    expect(s).toContain('/Count 2')
    expect(s).toContain('(Office Layout - 101\\" wide)'.replace('\\"', '"'))
  })

  it('escapes parentheses and maps typographic marks', () => {
    expect(pdfText('6′ 4″ × 2″')).toBe('6\' 4" x 2"')
    const pdf = new PdfBuilder()
    pdf.addPage(100, 100, (p) => p.text(0, 0, 'a (b) \\ c'))
    expect(decode(pdf.build())).toContain('(a \\(b\\) \\\\ c)')
  })

  it('measures text', () => {
    expect(textWidth('', 10)).toBe(0)
    expect(textWidth('iiii', 10)).toBeLessThan(textWidth('WWWW', 10))
  })
})
