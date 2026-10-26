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
export function planSvgMarkup(project: Project, width = 1600): { svg: string; width: number; height: number } {
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
  const height = Math.round(Math.min(2200, Math.max(700, width * aspect + 140)))
  const size = { w: width, h: height }
  const vp = fitBBox(box, { w: size.w, h: size.h - 70 }, 70, 20)
  vp.panY += 70
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
      measureDraft={null}
      wallDraft={null}
      mode="furniture"
      interactive={false}
      presentation
      fmt={fmt}
      screenExtras={
        <g>
          <text x={36} y={44} fontSize={24} fontWeight={650} fill={LIGHT.ink} fontFamily="-apple-system, 'SF Pro Display', Helvetica, Arial, sans-serif">{project.name}</text>
          <text x={36} y={68} fontSize={14} fill={LIGHT.ink2} fontFamily="-apple-system, 'SF Pro Text', Helvetica, Arial, sans-serif">{`${layout.name} · ${new Date().toLocaleDateString()}${arch.unresolved.some((u) => u.missing.length) ? ' · some dimensions not yet measured' : ''}`}</text>
        </g>
      }
    />,
  )
  return { svg, width: size.w, height: size.h }
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
