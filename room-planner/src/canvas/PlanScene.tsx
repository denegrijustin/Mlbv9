/**
 * Pure SVG renderer for the floor plan. Geometry is in inches inside a group scaled by the viewport zoom, so
 * furniture is always drawn at its true size; text, handles and dimension lines are drawn in screen pixels on top.
 */
import { useId, type ReactNode } from 'react'
import { FLUSH_TOLERANCE, type ClearanceEntry } from '../engine/clearance'
import type { FurnitureAnalysis } from '../engine/analysis'
import type { Collision } from '../engine/collisions'
import { interiorWallPolygon, OPEN_EXTENT, type Architecture, type Issue, type ResolvedArch, type ResolvedWall } from '../engine/room'
import { furniturePolygon } from '../engine/scene'
import type { Guide } from '../engine/snapping'
import { bbox, centroid, thickSegment, type Poly } from '../geometry/polygon'
import { add, dist, mul, type Vec } from '../geometry/vec'
import { luminance, shade } from '../lib/color'
import type { FurnitureItem, Measurement, ReferenceImage, Room, Settings } from '../model/types'
import type { Mode, SelectionKind, Viewport } from '../store/ui'
import { statusColor, type Theme } from './theme'
import { toScreen } from './view'

export interface SceneProps {
  theme: Theme
  vp: Viewport
  size: { w: number; h: number }
  room: Room
  arch: Architecture
  furniture: FurnitureItem[]
  ghost: FurnitureItem[]
  settings: Settings
  selection: { kind: SelectionKind; id: string } | null
  analysis: FurnitureAnalysis | null
  collisions: Map<string, Collision[]>
  issues: Issue[]
  guides: Guide[]
  measurements: Measurement[]
  measureDraft: { a: Vec; b: Vec } | null
  wallDraft: { a: Vec; b: Vec } | null
  reference?: ReferenceImage | null
  refEdit?: boolean
  mode: Mode
  interactive: boolean
  /** Presentation / export: hide chrome, optionally keep labels. */
  presentation: boolean
  fmt: (inches: number) => string
  /** Drawn in screen space above the scene (handles, HUD). */
  screenExtras?: ReactNode
  /** Extra attributes for the root svg (ref handlers are attached by the canvas). */
  svgProps?: React.SVGProps<SVGSVGElement>
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const P = (poly: Poly) => poly.map((p) => `${r3(p.x)},${r3(p.y)}`).join(' ')

/** Outer band of a wall, as drawn in plan. Perimeter walls sit outside the interior face; interior walls are centred. */
export function wallBand(w: ResolvedWall): Poly {
  if (w.kind === 'interior') return interiorWallPolygon(w)
  if (w.band) return w.band
  const t = w.thickness
  const out = mul(w.normalIn, -1)
  const a = add(w.a, mul(w.dir, -t))
  const b = add(w.b, mul(w.dir, t))
  return [a, b, add(b, mul(out, t)), add(a, mul(out, t))]
}

function openingBand(w: ResolvedWall, a: Vec, b: Vec): Poly {
  if (w.kind === 'interior') return thickSegment(a, b, w.thickness)
  const o = mul(w.normalIn, -w.thickness)
  return [a, b, add(b, o), add(a, o)]
}

/** Lines across a wall's thickness: 0 = interior face, 1 = outer face (perimeter); -0.5..0.5 for interior walls. */
function acrossWall(w: ResolvedWall, a: Vec, b: Vec, f: number): [Vec, Vec] {
  const off = w.kind === 'interior' ? mul(w.normalIn, w.thickness * (f - 0.5)) : mul(w.normalIn, -w.thickness * f)
  return [add(a, off), add(b, off)]
}

export function PlanScene(props: SceneProps) {
  const { theme: t, vp, size, arch, settings, mode, interactive, presentation } = props
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const px = (n: number) => n / vp.zoom
  const rr = arch.room
  const openX = rr.width === null
  const openY = rr.depth === null
  const We = rr.width ?? OPEN_EXTENT
  const De = rr.depth ?? OPEN_EXTENT

  // Where the floor fades out when a dimension has not been measured. This is a drawing aid, never a measurement.
  const maxY = Math.max(0, ...props.furniture.map((f) => bbox(furniturePolygon(f)).maxY))
  const maxX = Math.max(0, ...props.furniture.map((f) => bbox(furniturePolygon(f)).maxX))
  const fadeY0 = Math.max(96, maxY + 24)
  const fadeX0 = Math.max(96, maxX + 24)
  const FADE = 56

  const gridSize = settings.gridSize
  const showGrid = gridSize > 0 && gridSize * vp.zoom >= 5
  const showMajor = gridSize > 0 && gridSize < 12 && 12 * vp.zoom >= 10

  const issueIds = new Map<string, 'error' | 'warning' | 'info'>()
  for (const i of props.issues) for (const id of i.itemIds) {
    const cur = issueIds.get(id)
    if (!cur || i.severity === 'error') issueIds.set(id, i.severity)
  }

  const sel = props.selection
  const selected = (kind: SelectionKind, id: string) => sel?.kind === kind && sel.id === id
  const dimOn = settings.showClearance && !presentation

  const orderedFurniture = [...props.furniture].filter((f) => !f.hidden).sort((a, b) => Number(a.collides) - Number(b.collides))

  return (
    <svg
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
      xmlns="http://www.w3.org/2000/svg"
      className={interactive ? 'plan-surface' : undefined}
      style={{ display: 'block', background: t.bg }}
      {...props.svgProps}
    >
      <defs>
        {showGrid && (
          <pattern id={`${uid}grid`} width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
            <path d={`M ${gridSize} 0 L 0 0 L 0 ${gridSize}`} fill="none" stroke={t.grid} strokeWidth={px(1)} />
          </pattern>
        )}
        {showMajor && (
          <pattern id={`${uid}major`} width={12} height={12} patternUnits="userSpaceOnUse">
            <path d="M 12 0 L 0 0 L 0 12" fill="none" stroke={t.gridMajor} strokeWidth={px(1)} />
          </pattern>
        )}
        <pattern id={`${uid}hatch`} width={px(8)} height={px(8)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={px(8)} stroke={t.unmeasured} strokeWidth={px(1.4)} opacity="0.55" />
        </pattern>
        <pattern id={`${uid}wood`} width={px(7)} height={px(7)} patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2={px(7)} stroke={t.woodStroke} strokeWidth={px(0.9)} opacity="0.45" />
        </pattern>
        <linearGradient id={`${uid}gy`} gradientUnits="userSpaceOnUse" x1="0" y1={fadeY0} x2="0" y2={fadeY0 + FADE}>
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </linearGradient>
        <linearGradient id={`${uid}gx`} gradientUnits="userSpaceOnUse" x1={fadeX0} y1="0" x2={fadeX0 + FADE} y2="0">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </linearGradient>
        <mask id={`${uid}my`} maskUnits="userSpaceOnUse" x="-400" y="-400" width="4000" height="4000">
          <rect x="-400" y="-400" width="4000" height="4000" fill={`url(#${uid}gy)`} />
        </mask>
        <mask id={`${uid}mx`} maskUnits="userSpaceOnUse" x="-400" y="-400" width="4000" height="4000">
          <rect x="-400" y="-400" width="4000" height="4000" fill={`url(#${uid}gx)`} />
        </mask>
      </defs>

      <g transform={`translate(${r3(vp.panX)} ${r3(vp.panY)}) scale(${vp.zoom})`}>
        {/* ---------------------------------------------------- floor, grid, walls, openings (fade where unmeasured) */}
        <g mask={openX ? `url(#${uid}mx)` : undefined}>
          <g mask={openY ? `url(#${uid}my)` : undefined}>
            <polygon points={P(rr.polygon)} fill={t.floor} />
            {showGrid && <polygon points={P(rr.polygon)} fill={`url(#${uid}grid)`} />}
            {showMajor && <polygon points={P(rr.polygon)} fill={`url(#${uid}major)`} />}
            {props.reference?.visible && <ReferenceLayer r={props.reference} editable={!!props.refEdit && interactive && !props.reference.locked} />}
            {openY && !presentation && <rect x={0} y={fadeY0} width={We} height={FADE} fill={`url(#${uid}hatch)`} />}
            {openX && !presentation && <rect x={fadeX0} y={0} width={FADE} height={De} fill={`url(#${uid}hatch)`} />}

            {rr.walls.map((w) => {
              const band = wallBand(w)
              const isSel = selected('wall', w.id)
              return (
                <g key={w.id}>
                  <polygon
                    points={P(band)}
                    fill={w.kind === 'perimeter' ? t.wall : t.wallInterior}
                    stroke={isSel ? t.accent : 'none'}
                    strokeWidth={px(2.5)}
                    data-hit={interactive && mode === 'room' ? 'wall' : undefined}
                    data-id={w.id}
                    style={interactive && mode === 'room' ? { cursor: w.kind === 'interior' ? 'grab' : 'pointer' } : { pointerEvents: 'none' }}
                  />
                  {w.unbounded && w.kind === 'perimeter' && <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke={t.unmeasured} strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(5)}`} />}
                </g>
              )
            })}

            {/* openings: cut the wall, then draw the symbol */}
            {arch.arch.map((a) => (a.placed && a.wall && a.segment && (a.type === 'door' || a.type === 'window') ? <Opening key={a.id} a={a} t={t} px={px} uid={uid} selected={selected('arch', a.id)} interactive={interactive} /> : null))}
          </g>
        </g>

        {/* ---------------------------------------------------- door swing zones (only the region the leaf sweeps) */}
        {arch.arch.map((a) => {
          if (!a.swingZone || !a.leaf) return null
          const warn = issueIds.get(a.id)
          return (
            <g key={`sw-${a.id}`} style={{ pointerEvents: 'none' }}>
              <polygon points={P(a.swingZone)} fill={settings.rules.keepDoorSwingClear ? t.swing : 'none'} stroke={warn ? t.warn : t.accent} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(4)}`} opacity={0.9} />
              <line x1={a.leaf.hinge.x} y1={a.leaf.hinge.y} x2={a.leaf.tip.x} y2={a.leaf.tip.y} stroke={t.ink} strokeWidth={px(2)} strokeLinecap="round" />
              <circle cx={a.leaf.hinge.x} cy={a.leaf.hinge.y} r={px(2.4)} fill={t.ink} />
            </g>
          )
        })}

        {/* ---------------------------------------------------- fixed solids: pillars, built-ins, wall TVs */}
        {arch.arch.map((a) => {
          if (!a.placed || !a.polygon || a.type === 'door' || a.type === 'window') return null
          const isTv = a.type === 'tv'
          const isSel = selected('arch', a.id)
          const flag = issueIds.get(a.id)
          return (
            <g
              key={a.id}
              data-hit={interactive ? 'arch' : undefined}
              data-id={a.id}
              style={interactive ? { cursor: a.item.locked || mode !== 'room' ? 'pointer' : 'grab' } : undefined}
            >
              <polygon points={P(a.polygon)} fill={isTv ? '#2c2c2e' : t.wood} stroke={isSel ? t.accent : t.woodStroke} strokeWidth={px(isSel ? 2.5 : 1.25)} strokeLinejoin="round" />
              {!isTv && <polygon points={P(a.polygon)} fill={`url(#${uid}wood)`} style={{ pointerEvents: 'none' }} />}
              {flag && <polygon points={P(a.polygon)} fill="none" stroke={flag === 'error' ? t.bad : t.warn} strokeWidth={px(2)} strokeDasharray={`${px(5)} ${px(3)}`} style={{ pointerEvents: 'none' }} />}
            </g>
          )
        })}
        {/* wall-mounted items without a known projection: a line on the wall */}
        {arch.arch.map((a) => {
          if (a.type !== 'tv' || !a.placed || a.polygon || !a.segment) return null
          return <line key={a.id} x1={a.segment.a.x} y1={a.segment.a.y} x2={a.segment.b.x} y2={a.segment.b.y} stroke="#2c2c2e" strokeWidth={px(4)} strokeLinecap="round" data-hit={interactive ? 'arch' : undefined} data-id={a.id} style={interactive ? { cursor: 'pointer' } : undefined} />
        })}
        {/* issue flag for placed openings */}
        {arch.arch.map((a) => {
          const flag = issueIds.get(a.id)
          if (!flag || !a.segment || a.type === 'tv') return null
          return <line key={`fl-${a.id}`} x1={a.segment.a.x} y1={a.segment.a.y} x2={a.segment.b.x} y2={a.segment.b.y} stroke={flag === 'error' ? t.bad : t.warn} strokeWidth={px(3)} strokeDasharray={`${px(5)} ${px(3)}`} style={{ pointerEvents: 'none' }} />
        })}

        {/* ---------------------------------------------------- chair / working clearance zones */}
        {settings.showChairZone && props.analysis?.chairZone && !presentation &&
          props.analysis.chairZone.zones.map((z, i) => (
            <polygon key={i} points={P(z.polygon)} fill={statusColor(t, z.status)} fillOpacity={0.14} stroke={statusColor(t, z.status)} strokeOpacity={0.7} strokeWidth={px(1.25)} strokeDasharray={`${px(5)} ${px(4)}`} style={{ pointerEvents: 'none' }} />
          ))}

        {/* ---------------------------------------------------- other layout's furniture, as a faint reference */}
        {props.ghost.map((f) => (
          <polygon key={`g-${f.id}`} points={P(furniturePolygon(f))} fill="none" stroke={t.ink2} strokeOpacity={0.55} strokeWidth={px(1.5)} strokeDasharray={`${px(5)} ${px(4)}`} style={{ pointerEvents: 'none' }} />
        ))}

        {/* ---------------------------------------------------- furniture */}
        {orderedFurniture.map((f) => {
          const poly = furniturePolygon(f)
          const isSel = selected('furniture', f.id)
          const hit = props.collisions.get(f.id)
          const stroke = hit ? t.bad : isSel ? t.accent : shade(f.color, t.dark ? 0.3 : -0.3)
          return (
            <g key={f.id} data-hit={interactive ? 'furniture' : undefined} data-id={f.id} style={interactive ? { cursor: f.locked ? 'pointer' : 'grab' } : undefined} opacity={f.collides ? 1 : 0.88}>
              <polygon points={P(poly)} fill={f.color} stroke={stroke} strokeWidth={px(isSel || hit ? 2.25 : 1.25)} strokeLinejoin="round" />
            </g>
          )
        })}

        {/* ---------------------------------------------------- collision outlines */}
        {!presentation &&
          [...props.collisions.entries()].flatMap(([fid, list]) =>
            list.flatMap((c, i) => c.outlines.map((o, j) => <polygon key={`c-${fid}-${i}-${j}`} points={P(o)} fill={t.bad} fillOpacity={0.45} stroke={t.bad} strokeWidth={px(1.5)} style={{ pointerEvents: 'none' }} />)),
          )}
      </g>

      {/* ============================================================ screen-space layer */}
      <g style={{ pointerEvents: 'none' }}>
        <WallLabels {...props} />
        {!presentation && dimOn && props.analysis && <ClearanceLines entries={props.analysis.clearances} {...props} />}
        {!presentation && props.analysis?.chairZone && settings.showChairZone && <ChairLabels {...props} />}
        {props.guides.map((g, i) => {
          const a = toScreen(vp, g.axis === 'x' ? { x: g.value, y: g.from } : { x: g.from, y: g.value })
          const b = toScreen(vp, g.axis === 'x' ? { x: g.value, y: g.to } : { x: g.to, y: g.value })
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={t.guide} strokeWidth={1} strokeDasharray={g.kind === 'center' ? '5 4' : undefined} opacity={0.9} />
        })}
        <NameLabels {...props} />
        <MeasureLayer {...props} />
      </g>
      {props.screenExtras}
    </svg>
  )
}

// ------------------------------------------------------------------ openings

function Opening({ a, t, px, uid, selected, interactive }: { a: ResolvedArch; t: Theme; px: (n: number) => number; uid: string; selected: boolean; interactive: boolean }) {
  const w = a.wall!
  const { a: p, b: q } = a.segment!
  const band = openingBand(w, p, q)
  const isWindow = a.type === 'window'
  const hit = interactive ? { 'data-hit': 'arch', 'data-id': a.id } : {}
  void uid
  if (isWindow) {
    const lines = [0, 0.5, 1].map((f) => acrossWall(w, p, q, f))
    // the sash lines run along the wall at three depths; the glass fills the opening
    return (
      <g {...hit} style={interactive ? { cursor: 'pointer' } : undefined}>
        <polygon points={P(band)} fill={t.glass} stroke={selected ? t.accent : t.ink3} strokeWidth={px(selected ? 2.5 : 1)} />
        {lines.map(([s, e], i) => (
          <line key={i} x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={t.ink2} strokeWidth={px(i === 1 ? 1.4 : 1)} />
        ))}
      </g>
    )
  }
  const door = a.item.type === 'door' ? a.item : null
  return (
    <g {...hit} style={interactive ? { cursor: 'pointer' } : undefined}>
      <polygon points={P(band)} fill={t.bg} stroke={selected ? t.accent : 'none'} strokeWidth={px(2.5)} />
      {door?.style === 'opening' && (() => {
        const [s, e] = acrossWall(w, p, q, 0)
        return <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={t.ink3} strokeWidth={px(1.2)} strokeDasharray={`${px(4)} ${px(3)}`} />
      })()}
    </g>
  )
}

// ------------------------------------------------------------------ screen-space pieces

function Chip({ x, y, text, fg, bg, border, size = 11, bold = false, anchor = 'middle' }: { x: number; y: number; text: string; fg: string; bg: string; border?: string; size?: number; bold?: boolean; anchor?: 'middle' | 'start' | 'end' }) {
  const w = text.length * (size * 0.58) + 12
  const h = size + 9
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x
  return (
    <g>
      <rect x={x0} y={y - h / 2} width={w} height={h} rx={h / 2} fill={bg} stroke={border ?? 'none'} strokeWidth={1} />
      <text x={x0 + w / 2} y={y} textAnchor="middle" dominantBaseline="central" fontSize={size} fontWeight={bold ? 650 : 520} fill={fg} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {text}
      </text>
    </g>
  )
}
export { Chip }

function DimLine({ a, b, label, color, theme }: { a: Vec; b: Vec; label: string; color: string; theme: Theme }) {
  const len = dist(a, b)
  if (len < 14) return null
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  const tick = 4.5
  return (
    <g>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={1.25} />
      <line x1={a.x - uy * tick} y1={a.y + ux * tick} x2={a.x + uy * tick} y2={a.y - ux * tick} stroke={color} strokeWidth={1.25} />
      <line x1={b.x - uy * tick} y1={b.y + ux * tick} x2={b.x + uy * tick} y2={b.y - ux * tick} stroke={color} strokeWidth={1.25} />
      <Chip x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} text={label} fg={color} bg={theme.chip} border={color} bold />
    </g>
  )
}

function ClearanceLines({ entries, vp, theme: t, fmt }: { entries: ClearanceEntry[] } & SceneProps) {
  const walls = entries.filter((e) => (e.kind === 'wall' || e.kind === 'interior-wall') && e.distance > FLUSH_TOLERANCE && e.distance <= 160 && e.status !== 'collision')
  const others = entries.filter((e) => e.kind !== 'wall' && e.kind !== 'interior-wall' && e.distance > FLUSH_TOLERANCE && e.distance <= 120 && e.status !== 'collision').slice(0, 3)
  // Drop a line that merely repeats one already drawn (e.g. a window flush with the wall it sits in).
  const drawn: ClearanceEntry[] = []
  const unique = [...walls, ...others].filter((e) => {
    const dup = drawn.some((d) => Math.abs(d.distance - e.distance) < 0.5 && dist(d.from, e.from) < 3)
    if (!dup) drawn.push(e)
    return !dup
  })
  return (
    <g>
      {unique.map((e) => (
        <DimLine key={e.id} a={toScreen(vp, e.from)} b={toScreen(vp, e.to)} label={fmt(e.distance)} color={statusColor(t, e.status)} theme={t} />
      ))}
    </g>
  )
}

function ChairLabels({ analysis, vp, theme: t, fmt, settings }: SceneProps) {
  const z = analysis?.chairZone
  if (!z) return null
  return (
    <g>
      {z.zones.map((zone, i) => {
        const mid = { x: (zone.a.x + zone.b.x) / 2, y: (zone.a.y + zone.b.y) / 2 }
        const end = add(mid, mul(zone.n, Math.min(zone.free, z.required)))
        const s = toScreen(vp, end)
        const m = toScreen(vp, mid)
        const color = statusColor(t, zone.status)
        const label = zone.free >= z.required - 1e-6 ? `Chair space ${fmt(z.required)}+` : `Chair space ${fmt(zone.free)} of ${fmt(settings.rules.chairClearance)}`
        return (
          <g key={i}>
            <line x1={m.x} y1={m.y} x2={s.x} y2={s.y} stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.85} />
            <circle cx={s.x} cy={s.y} r={3} fill={color} />
            <Chip x={s.x} y={s.y + (zone.n.y >= 0 ? 16 : -16)} text={label} fg={color} bg={t.chip} border={color} bold />
          </g>
        )
      })}
    </g>
  )
}

function ReferenceLayer({ r, editable }: { r: ReferenceImage; editable: boolean }) {
  const w = r.naturalWidth * r.inchesPerPixel
  const h = r.naturalHeight * r.inchesPerPixel
  return (
    <g data-hit={editable ? 'reference' : undefined} style={editable ? { cursor: 'move' } : { pointerEvents: 'none' }} transform={`rotate(${r.rotation} ${r.x + w / 2} ${r.y + h / 2})`}>
      <image href={r.dataUrl} x={r.x} y={r.y} width={w} height={h} opacity={r.opacity} preserveAspectRatio="none" />
      {editable && <rect x={r.x} y={r.y} width={w} height={h} fill="none" stroke="#0071e3" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray="6 4" />}
    </g>
  )
}

function WallLabels({ arch, vp, theme: t, fmt, mode, settings, presentation, interactive }: SceneProps) {
  const rr = arch.room
  const show = mode === 'room' || settings.showNames || presentation
  if (!show) return null
  const chips: ReactNode[] = []
  const off = 18
  let said = false
  for (const w of rr.walls) {
    if (w.kind === 'interior' && mode !== 'room') continue
    const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }
    const out = w.kind === 'perimeter' ? mul(w.normalIn, -1) : w.normalIn
    if (w.length === null) {
      // Say it once per missing dimension (east and west both depend on the same depth).
      const key = w.id === 'north' || w.id === 'south' ? 'w' : 'd'
      if (said && key === 'd') continue
      if (key === 'd') said = true
      // unmeasured: say so, near the top of the wall rather than at an invented midpoint
      const vertical = w.id === 'west' || w.id === 'east'
      const along = vertical ? { x: w.a.x, y: 52 } : { x: 52, y: w.a.y }
      const s = toScreen(vp, along)
      const gap = (w.thickness + 0) * vp.zoom + 10
      const text = vertical ? 'Depth not measured' : 'Width not measured'
      if (vertical) chips.push(<Chip key={w.id} x={s.x + out.x * gap} y={s.y} text={text} fg={t.unmeasured} bg={t.chip} border={t.unmeasured} bold anchor={out.x < 0 ? 'end' : 'start'} />)
      else chips.push(<Chip key={w.id} x={s.x} y={s.y + out.y * (gap + 8)} text={text} fg={t.unmeasured} bg={t.chip} border={t.unmeasured} bold />)
      continue
    }
    const s = toScreen(vp, mid)
    const thick = (w.kind === 'perimeter' ? w.thickness : w.thickness / 2) * vp.zoom
    const p = { x: s.x + out.x * (thick + off), y: s.y + out.y * (thick + off) }
    const isSel = false
    chips.push(
      <g key={w.id} data-hit={interactive && mode === 'room' ? 'wall' : undefined} data-id={w.id} style={{ pointerEvents: interactive && mode === 'room' ? 'auto' : 'none', cursor: 'pointer' }}>
        <Chip x={p.x} y={p.y} text={fmt(w.length)} fg={isSel ? t.accent : t.chipInk} bg={t.chip} border={t.ink3} bold />
      </g>,
    )
  }
  return <g>{chips}</g>
}

function NameLabels({ furniture, vp, theme: t, settings, presentation, arch }: SceneProps) {
  if (!settings.showNames && !presentation) return null
  const items: ReactNode[] = []
  for (const f of furniture) {
    if (f.hidden) continue
    const poly = furniturePolygon(f)
    const b = bbox(poly)
    const w = (b.maxX - b.minX) * vp.zoom
    const h = (b.maxY - b.minY) * vp.zoom
    if (Math.min(w, h) < 26 && Math.max(w, h) < 70) continue
    const c = toScreen(vp, centroid(poly))
    const dark = luminance(f.color) < 0.42
    items.push(
      <text key={f.id} x={c.x} y={c.y} textAnchor="middle" dominantBaseline="central" fontSize={11.5} fontWeight={560} fill={dark ? '#ffffff' : '#1d1d1f'} opacity={0.92}>
        {f.name}
      </text>,
    )
  }
  for (const a of arch.arch) {
    if (!a.placed) continue
    if (a.polygon && a.type !== 'tv') {
      const c = toScreen(vp, centroid(a.polygon))
      const bb = bbox(a.polygon)
      if (Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY) * vp.zoom < 22) continue
      items.push(
        <text key={a.id} x={c.x} y={c.y} textAnchor="middle" dominantBaseline="central" fontSize={10.5} fontWeight={560} fill="#fff" opacity={0.95}>
          {a.item.name}
        </text>,
      )
    } else if (a.segment && a.wall && vp.zoom >= 2.2) {
      const mid = toScreen(vp, { x: (a.segment.a.x + a.segment.b.x) / 2, y: (a.segment.a.y + a.segment.b.y) / 2 })
      const out = mul(a.wall.normalIn, a.wall.kind === 'perimeter' ? -1 : 1)
      const d = (a.wall.thickness + 4) * vp.zoom + 10
      items.push(
        <text key={a.id} x={mid.x + out.x * d} y={mid.y + out.y * d} textAnchor="middle" dominantBaseline="central" fontSize={10.5} fontWeight={520} fill={t.ink2}>
          {a.item.name}
        </text>,
      )
    }
  }
  return <g>{items}</g>
}

function MeasureLayer({ measurements, measureDraft, wallDraft, vp, theme: t, fmt }: SceneProps) {
  const line = (a: Vec, b: Vec, key: string, color: string) => {
    const A = toScreen(vp, a)
    const B = toScreen(vp, b)
    return (
      <g key={key}>
        <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={color} strokeWidth={1.75} />
        <circle cx={A.x} cy={A.y} r={3.5} fill={color} />
        <circle cx={B.x} cy={B.y} r={3.5} fill={color} />
        <Chip x={(A.x + B.x) / 2} y={(A.y + B.y) / 2 - 14} text={fmt(dist(a, b))} fg="#fff" bg={color} bold />
      </g>
    )
  }
  return (
    <g>
      {measurements.map((m) => line(m.a, m.b, m.id, t.accent))}
      {measureDraft && line(measureDraft.a, measureDraft.b, 'draft', t.accent)}
      {wallDraft && line(wallDraft.a, wallDraft.b, 'wall-draft', t.wallInterior)}
    </g>
  )
}
