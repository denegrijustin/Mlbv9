import type { Project, ReferenceImage } from '../model/types'

const MAX_SIDE = 2000

/**
 * Read a photo or drawing for use as a tracing underlay. It is downscaled so the project stays small enough to
 * save and export. Its scale is NOT known until the user calibrates it against a real measured distance.
 */
export async function loadReferenceFile(file: File, project: Pick<Project, 'room'>): Promise<ReferenceImage> {
  if (!/^image\//.test(file.type)) throw new Error('Choose an image file (JPEG, PNG, WebP).')
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('That image could not be opened.'))
      img.src = url
    })
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * k))
    const h = Math.max(1, Math.round(img.naturalHeight * k))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const g = canvas.getContext('2d')!
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, w, h)
    g.drawImage(img, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    // Placeholder size only so the photo is visible: roughly as wide as the room. Not a measurement.
    const target = project.room.width ?? 120
    return {
      dataUrl,
      naturalWidth: w,
      naturalHeight: h,
      x: 0,
      y: 0,
      inchesPerPixel: target / w,
      calibrated: false,
      rotation: 0,
      opacity: 0.55,
      visible: true,
      locked: false,
      name: file.name.replace(/\.[a-z0-9]+$/i, '') || 'Reference photo',
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Rescale about plan point `anchor` so a measured distance matches reality. */
export function calibrate(ref: ReferenceImage, anchor: { x: number; y: number }, pixelsApart: number, realInches: number): Partial<ReferenceImage> {
  const k = realInches / (pixelsApart * ref.inchesPerPixel)
  const w = ref.naturalWidth * ref.inchesPerPixel
  const h = ref.naturalHeight * ref.inchesPerPixel
  const cx = ref.x + w / 2
  const cy = ref.y + h / 2
  const ncx = anchor.x + (cx - anchor.x) * k
  const ncy = anchor.y + (cy - anchor.y) * k
  return { inchesPerPixel: ref.inchesPerPixel * k, x: ncx - (w * k) / 2, y: ncy - (h * k) / 2, calibrated: true }
}
