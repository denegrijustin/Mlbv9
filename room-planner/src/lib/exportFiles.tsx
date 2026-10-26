import { renderToStaticMarkup } from 'react-dom/server'
import { PlanScene } from '../canvas/PlanScene'
import { LIGHT } from '../canvas/theme'
import { fitBBox } from '../canvas/view'
import { collisionMap } from '../engine/analysis'
import { resolveArchitecture } from '../engine/room'
import { furniturePolygon } from '../engine/scene'
import { bbox, unionBBox, type BBox } from '../geometry/polygon'
import { exportProject, importProject, type ImportResult } from '../model/serialize'
import type { Project } from '../model/types'
import { lengthFormatter } from './format'
import { PdfBuilder } from './pdf'

declare global {
  interface Window {
    claude?: { use: (name: string) => Promise<unknown> }
  }
}
interface DownloadsApi {
  save: (r: { filename: string; data: Blob | string }) => Promise<{ status: string }>
}

/**
 * Save a file. Inside a Claude artifact the viewer blocks script-started downloads, so the `downloads` capability
 * (viewer confirms the name) is used when it exists; in a normal browser an ordinary download is started.
 * Resolves false only when the viewer declined.
 */
export async function download(filename: string, blob: Blob): Promise<boolean> {
  try {
    const dl = (await window.claude?.use('downloads')) as DownloadsApi | null | undefined
    if (dl) {
      try {
        await dl.save({ filename, data: blob })
        return true
      } catch (e) {
        if ((e as { code?: string } | null)?.code === 'declined') return false
        // any other refusal: fall through to a plain download
      }
    }
  } catch {
    /* no capability host */
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return true
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room'

export function exportJson(project: Project): Promise<boolean> {
  return download(`${slug(project.name)}.roomplan.json`, new Blob([exportProject(project)], { type: 'application/json' }))
}

export async function importJsonFile(file: File): Promise<ImportResult> {
  return importProject(await file.text())
}

/** Standalone SVG of the active layout for sharing: names and measurements on, no editing chrome. */
export function planSvgMarkup(project: Project, width = 1600, opts: { title?: boolean; height?: number } = {}): { svg: string; width: number; height: number; zoom: number } {
  const withTitle = opts.title !== false
  const layout = project.layouts.find((l) => l.id === project.activeLayoutId) ?? project.layouts[0]
  const arch = resolveArchitecture(project.room)
  const furniture = layout.furniture.filter((f) => !f.hidden)
  const fb = unionBBox(furniture.map((f) => bbox(furniturePolygon(f))))
  const W = arch.room.width ?? Math.max(120, (fb?.maxX ?? 0) + 24)
  const D = arch.room.depth ?? Math.max(96, (fb?.maxY ?? 0) + 24)
  const pad = project.room.wallThickness + 22
  let box: BBox = { minX: -pad, minY: -pad, maxX: W + pad, maxY: D + pad }
  if (fb) box = unionBBox([box, fb])!
  const aspect = (box.maxY - box.minY) / (box.maxX - box.minX)
  const head = withTitle ? 70 : 0
  const height = opts.height ?? Math.round(Math.min(2200, Math.max(700, width * aspect + (withTitle ? 140 : 0))))
  const size = { w: width, h: height }
  const vp = fitBBox(box, { w: size.w, h: size.h - head }, withTitle ? 70 : 20, 20)
  vp.panY += head
  const settings = { ...project.settings, showNames: true, showClearance: false, showChairZone: false }
  const fmt = lengthFormatter(settings)
  const ctx = { arch, furniture, settings: { rules: settings.rules } }
  const svg = renderToStaticMarkup(
    <PlanScene
      theme={LIGHT}
      vp={vp}
      size={size}
      room={project.room}
      arch={arch}
      furniture={furniture}
      ghost={[]}
      settings={settings}
      selection={null}
      analysis={null}
      collisions={collisionMap(ctx)}
      issues={[]}
      guides={[]}
      measurements={project.measurements}
      reference={project.reference ?? null}
      measureDraft={null}
      wallDraft={null}
      mode="furniture"
      interactive={false}
      presentation
      fmt={fmt}
      screenExtras={
        withTitle && <g>
          <text x={36} y={44} fontSize={24} fontWeight={650} fill={LIGHT.ink} fontFamily="-apple-system, 'SF Pro Display', Helvetica, Arial, sans-serif">{project.name}</text>
          <text x={36} y={68} fontSize={14} fill={LIGHT.ink2} fontFamily="-apple-system, 'SF Pro Text', Helvetica, Arial, sans-serif">{`${layout.name} · ${new Date().toLocaleDateString()}${arch.unresolved.some((u) => u.missing.length) ? ' · some dimensions not yet measured' : ''}`}</text>
        </g>
      }
    />,
  )
  return { svg, width: size.w, height: size.h, zoom: vp.zoom }
}

export async function exportPng(project: Project, scale = 2): Promise<boolean> {
  const { svg, width, height } = planSvgMarkup(project)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('Could not render the plan image'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const g = canvas.getContext('2d')!
    g.scale(scale, scale)
    g.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) throw new Error('Could not create the PNG')
    const layout = project.layouts.find((l) => l.id === project.activeLayoutId) ?? project.layouts[0]
    return await download(`${slug(project.name)}-${slug(layout.name)}.png`, blob)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function exportSvg(project: Project): Promise<boolean> {
  const { svg } = planSvgMarkup(project)
  return download(`${slug(project.name)}.svg`, new Blob([svg], { type: 'image/svg+xml' }))
}

async function rasterize(svg: string, width: number, height: number, scale: number, type: 'image/png' | 'image/jpeg'): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('Could not render the plan image'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const g = canvas.getContext('2d')!
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.scale(scale, scale)
    g.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.92))
    if (!blob) throw new Error('Could not create the image')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Letter-size PDF: the plan on page 1 with a printed scale, and a furniture schedule. */
export async function buildPlanPdf(project: Project): Promise<Uint8Array> {
  const layout = project.layouts.find((l) => l.id === project.activeLayoutId) ?? project.layouts[0]
  const arch = resolveArchitecture(project.room)
  const fmt = lengthFormatter(project.settings)
  // Page geometry first: the plan is drawn at 1.5 px per point into exactly the space it will occupy, so labels
  // come out at a readable size and nothing is letterboxed.
  const bb0 = unionBBox(layout.furniture.filter((f) => !f.hidden).map((f) => bbox(furniturePolygon(f))))
  const roomW = arch.room.width ?? (bb0?.maxX ?? 120)
  const roomD = arch.room.depth ?? (bb0?.maxY ?? 96)
  const landscape = roomW >= roomD
  const PW = landscape ? 792 : 612
  const PH = landscape ? 612 : 792
  const M = 36
  const head = 58
  const foot = 62
  const availW = PW - 2 * M
  const availH = PH - 2 * M - head - foot
  const PX = 1.5
  const { svg, width, height, zoom } = planSvgMarkup(project, Math.round(availW * PX), { title: false, height: Math.round(availH * PX) })
  const jpeg = new Uint8Array(await (await rasterize(svg, width, height, 2, 'image/jpeg')).arrayBuffer())
  const pdf = new PdfBuilder()
  pdf.setTitle(`${project.name} - ${layout.name}`)
  const imgId = pdf.addJpeg(jpeg, Math.round(width * 2), Math.round(height * 2))
  const w = availW
  const h = availH
  // printed scale: paper inches per real inch
  const paperPerReal = ((zoom / width) * w) / 72
  const ratio = Math.round(1 / paperPerReal)
  const date = new Date().toLocaleDateString()
  const gaps = arch.unresolved.filter((u) => u.missing.length)

  pdf.addPage(PW, PH, (p) => {
    p.text(M, PH - M - 16, project.name, { size: 20, bold: true })
    p.text(M, PH - M - 34, `${layout.name}  ·  ${date}`, { size: 10.5, gray: 0.4 })
    p.text(PW - M, PH - M - 16, `Scale 1:${ratio}`, { size: 11, bold: true, align: 'right' })
    p.text(PW - M, PH - M - 31, `1" on paper = ${fmt(ratio)} (printed at 100%)`, { size: 9, gray: 0.4, align: 'right' })
    p.line(M, PH - M - head + 8, PW - M, PH - M - head + 8)
    p.image(imgId, M + (availW - w) / 2, PH - M - head - h, w, h)
    const y0 = M + foot - 14
    p.line(M, y0 + 8, PW - M, y0 + 8)
    p.text(M, y0 - 6, `Units: ${project.settings.units === 'ftin' ? 'feet and inches' : 'inches'}. Interior dimensions are wall surface to wall surface.`, { size: 8.5, gray: 0.35 })
    if (gaps.length) p.text(M, y0 - 19, `Not yet measured: ${gaps.map((g2) => g2.name).join(', ')}.`, { size: 8.5, gray: 0.35 })
  })

  const rows = layout.furniture.filter((f) => !f.hidden)
  if (rows.length) {
    const LH = 16
    const perPage = Math.floor((PH - 2 * M - 70) / LH)
    for (let start = 0; start < rows.length; start += perPage) {
      pdf.addPage(PW, PH, (p) => {
        let y = PH - M - 16
        p.text(M, y, 'Furniture schedule', { size: 16, bold: true })
        p.text(M, y - 16, `${project.name} · ${layout.name}`, { size: 9.5, gray: 0.4 })
        y -= 46
        const cols = { name: M, size: M + 230, pos: M + 360, rot: PW - M }
        p.text(cols.name, y, 'Item', { size: 9, bold: true })
        p.text(cols.size, y, 'Width x depth', { size: 9, bold: true })
        p.text(cols.pos, y, 'From west / north wall', { size: 9, bold: true })
        p.text(cols.rot, y, 'Rotation', { size: 9, bold: true, align: 'right' })
        p.line(M, y - 5, PW - M, y - 5, 0.5, 0.75)
        y -= LH + 2
        for (const f of rows.slice(start, start + perPage)) {
          const b = bbox(furniturePolygon(f))
          p.text(cols.name, y, f.name.length > 38 ? `${f.name.slice(0, 36)}...` : f.name, { size: 9.5 })
          p.text(cols.size, y, `${fmt(f.width)} x ${fmt(f.depth)}`, { size: 9.5 })
          p.text(cols.pos, y, `${fmt(b.minX)} / ${fmt(b.minY)}`, { size: 9.5 })
          p.text(cols.rot, y, `${Math.round(f.rotation * 10) / 10}°`, { size: 9.5, align: 'right' })
          y -= LH
        }
      })
    }
  }
  return pdf.build()
}

export async function exportPdf(project: Project): Promise<boolean> {
  const layout = project.layouts.find((l) => l.id === project.activeLayoutId) ?? project.layouts[0]
  const bytes = await buildPlanPdf(project)
  return download(`${slug(project.name)}-${slug(layout.name)}.pdf`, new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }))
}
