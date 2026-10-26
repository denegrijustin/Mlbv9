/**
 * A very small PDF writer: Helvetica text, rules and JPEG images. Enough for a title block, the plan and a schedule,
 * with no dependency. Coordinates are PDF points (1/72 in) with the origin at the bottom-left of the page.
 */

const enc = new TextEncoder()

/** Map text to the Latin-1 subset that standard PDF fonts can show. */
export function pdfText(s: string): string {
  return s
    .replace(/[″”“]/g, '"')
    .replace(/[′’‘]/g, "'")
    .replace(/×/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/≈/g, '~')
    .replace(/[^\x20-\xff]/g, '?')
}

const esc = (s: string) => pdfText(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

// Helvetica advance widths (per 1000 em) for ASCII 32..126, enough to wrap and right-align text.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584]
export function textWidth(s: string, size: number, bold = false): number {
  let w = 0
  for (const ch of pdfText(s)) {
    const c = ch.charCodeAt(0)
    w += c >= 32 && c <= 126 ? HELV[c - 32] : 556
  }
  return (w / 1000) * size * (bold ? 1.06 : 1)
}

export interface PageContext {
  width: number
  height: number
  text: (x: number, y: number, s: string, opts?: { size?: number; bold?: boolean; gray?: number; align?: 'left' | 'right' | 'center' }) => void
  line: (x1: number, y1: number, x2: number, y2: number, gray?: number, width?: number) => void
  image: (id: number, x: number, y: number, w: number, h: number) => void
}

interface ImageObj {
  data: Uint8Array
  width: number
  height: number
}

export class PdfBuilder {
  private images: ImageObj[] = []
  private pages: Array<{ w: number; h: number; ops: string[]; imgs: number[] }> = []
  private title = ''

  setTitle(t: string) {
    this.title = t
  }

  /** Register a JPEG; returns its id for `image()`. */
  addJpeg(data: Uint8Array, width: number, height: number): number {
    this.images.push({ data, width, height })
    return this.images.length - 1
  }

  addPage(width: number, height: number, draw: (p: PageContext) => void) {
    const page = { w: width, h: height, ops: [] as string[], imgs: [] as number[] }
    const n = (v: number) => (Math.round(v * 100) / 100).toString()
    const ctx: PageContext = {
      width,
      height,
      text: (x, y, s, o = {}) => {
        const size = o.size ?? 10
        const bold = !!o.bold
        const w = textWidth(s, size, bold)
        const px = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x
        const g = o.gray ?? 0
        page.ops.push(`BT /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${n(g)} g ${n(px)} ${n(y)} Td (${esc(s)}) Tj ET`)
      },
      line: (x1, y1, x2, y2, gray = 0.8, w = 0.5) => {
        page.ops.push(`${n(gray)} G ${n(w)} w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`)
      },
      image: (id, x, y, w, h) => {
        if (!page.imgs.includes(id)) page.imgs.push(id)
        page.ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(y)} cm /Im${id} Do Q`)
      },
    }
    draw(ctx)
    this.pages.push(page)
  }

  build(): Uint8Array {
    const chunks: Uint8Array[] = []
    const offsets: number[] = []
    let len = 0
    const push = (b: Uint8Array | string) => {
      const u = typeof b === 'string' ? latin1(b) : b
      chunks.push(u)
      len += u.length
    }
    const obj = (num: number, body: string | Uint8Array[] ) => {
      offsets[num] = len
      push(`${num} 0 obj\n`)
      if (typeof body === 'string') push(body)
      else for (const b of body) push(b)
      push('\nendobj\n')
    }

    // numbering: 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then images, then (page, content) pairs
    const imgBase = 6
    const pageBase = imgBase + this.images.length
    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
    obj(2, `<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages.map((_, i) => `${pageBase + i * 2} 0 R`).join(' ')}] >>`)
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
    obj(5, `<< /Title (${esc(this.title)}) /Producer (Room Planner) >>`)
    this.images.forEach((im, i) => {
      obj(imgBase + i, [
        latin1(`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n`),
        im.data,
        latin1('\nendstream'),
      ])
    })
    this.pages.forEach((p, i) => {
      const pn = pageBase + i * 2
      const xo = p.imgs.map((id) => `/Im${id} ${imgBase + id} 0 R`).join(' ')
      obj(pn, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w} ${p.h}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xo} >> >> /Contents ${pn + 1} 0 R >>`)
      const stream = latin1(p.ops.join('\n'))
      obj(pn + 1, [latin1(`<< /Length ${stream.length} >>\nstream\n`), stream, latin1('\nendstream')])
    })
    const total = pageBase + this.pages.length * 2
    const xref = len
    let x = `xref\n0 ${total}\n0000000000 65535 f \n`
    for (let i = 1; i < total; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
    push(x)
    push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
    const out = new Uint8Array(len)
    let at = 0
    for (const c of chunks) {
      out.set(c, at)
      at += c.length
    }
    return out
  }
}

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}
void enc

export function dataUrlToBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
