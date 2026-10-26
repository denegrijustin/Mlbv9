import { useEffect, useRef, useState, type ReactNode } from 'react'
import { formatLength, parseLength, type UnitSystem } from '../geometry/units'

// ------------------------------------------------------------------ icons (24px stroke icons)
const PATHS: Record<string, string[]> = {
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  zoomIn: ['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'm21 21-4.3-4.3', 'M11 8v6M8 11h6'],
  zoomOut: ['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'm21 21-4.3-4.3', 'M8 11h6'],
  fit: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
  rotL: ['M2.5 2v6h6', 'M2.66 15.57a10 10 0 1 0 .57-8.38'],
  rotR: ['M21.5 2v6h-6', 'M21.34 15.57a10 10 0 1 1-.57-8.38'],
  flipH: ['m3 7 5 5-5 5V7', 'm21 7-5 5 5 5V7', 'M12 20v2', 'M12 14v2', 'M12 8v2', 'M12 2v2'],
  flipV: ['m17 3-5 5-5-5h10', 'm17 21-5-5-5 5h10', 'M4 12H2', 'M10 12H8', 'M16 12h-2', 'M22 12h-2'],
  lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  unlock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M8 11V7a4 4 0 0 1 7.5-2'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  eyeOff: ['M3 3l18 18', 'M10.6 6.1A9.7 9.7 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9', 'M6.7 6.7C3.6 8.6 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.3-1'],
  copy: ['M11 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M10 11v6M14 11v6'],
  plus: ['M12 5v14M5 12h14'],
  ruler: ['M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z', 'm14.5 12.5 2-2', 'm11.5 9.5 2-2', 'm8.5 6.5 2-2', 'm17.5 15.5 2-2'],
  layers: ['m12 2 9 5-9 5-9-5 9-5z', 'm3 12 9 5 9-5', 'm3 17 9 5 9-5'],
  sliders: ['M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
  image: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M9 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'm21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21'],
  cube: ['M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z', 'm3.3 7 8.7 5 8.7-5', 'M12 22V12'],
  check: ['M20 6 9 17l-5-5'],
  warning: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
  search: ['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'm21 21-4.3-4.3'],
  close: ['M18 6 6 18M6 6l12 12'],
  chevron: ['m6 9 6 6 6-6'],
  wall: ['M3 5h18v14H3z', 'M3 12h18', 'M9 5v7', 'M15 12v7'],
  door: ['M13 4h3a2 2 0 0 1 2 2v14', 'M2 20h3', 'M13 20h9', 'M10 12v.01', 'M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z'],
  opening: ['M4 21V8a8 8 0 0 1 16 0v13', 'M2 21h20'],
  window: ['M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M12 3v18', 'M4 12h16'],
  pillar: ['M6 6h12v12H6z', 'M6 18 18 6', 'M6 12l6-6', 'M12 18l6-6'],
  bookcase: ['M4 3h16v18H4z', 'M4 9h16', 'M4 15h16', 'M9 3v6', 'M14 9v6'],
  tv: ['M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M8 21h8', 'M12 17v4'],
  magnet: ['m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15', 'm5 8 4 4', 'm12 16 4 4'],
  grid: ['M3 3h18v18H3z', 'M3 9h18', 'M3 15h18', 'M9 3v18', 'M15 3v18'],
  more: ['M12 12h.01', 'M19 12h.01', 'M5 12h.01'],
  save: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h8'],
  info: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 16v-4', 'M12 8h.01'],
  presentation: ['M2 3h20', 'M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3', 'm7 21 5-5 5 5'],
  move: ['m5 9-3 3 3 3', 'm9 5 3-3 3 3', 'm15 19-3 3-3-3', 'm19 9 3 3-3 3', 'M2 12h20', 'M12 2v20'],
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18, className, strokeWidth = 1.75 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}

// ------------------------------------------------------------------ buttons
export function IconButton({ icon, label, onClick, disabled, active, size = 32, danger, className = '' }: { icon: IconName; label: string; onClick?: () => void; disabled?: boolean; active?: boolean; size?: number; danger?: boolean; className?: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={{ width: size, height: size }}
      className={`inline-flex items-center justify-center rounded-lg transition-colors ${disabled ? 'opacity-35' : active ? 'bg-accentsoft text-accent' : danger ? 'text-bad hover:bg-badsoft' : 'text-ink hover:bg-fill'} ${className}`}
    >
      <Icon name={icon} size={Math.round(size * 0.56)} />
    </button>
  )
}

export function Button({ children, onClick, variant = 'secondary', icon, disabled, className = '', title, full }: { children?: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: IconName; disabled?: boolean; className?: string; title?: string; full?: boolean }) {
  const v =
    variant === 'primary'
      ? 'bg-accent text-white hover:brightness-110'
      : variant === 'danger'
        ? 'bg-badsoft text-bad hover:brightness-95'
        : variant === 'ghost'
          ? 'text-ink hover:bg-fill'
          : 'bg-fill text-ink hover:bg-[var(--fill-hover)]'
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition ${full ? 'w-full' : ''} ${disabled ? 'opacity-40' : ''} ${v} ${className}`}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  )
}

export function Segmented<T extends string | number>({ value, onChange, options, size = 'md', label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode; title?: string; disabled?: boolean }>; size?: 'sm' | 'md'; label?: string }) {
  return (
    <div role="group" aria-label={label} className={`inline-flex rounded-[10px] bg-fill p-0.5 ${size === 'sm' ? 'text-[12px]' : 'text-[13px]'}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          disabled={o.disabled}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-[8px] px-3 font-medium transition ${size === 'sm' ? 'h-6' : 'h-7'} ${o.disabled ? 'opacity-35' : ''} ${o.value === value ? 'bg-solid text-ink shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-ink2 hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${checked ? 'bg-good' : 'bg-[var(--line-strong)]'}`} style={checked ? { background: 'var(--good)' } : undefined}>
      <span className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-[2px]'}`} />
    </button>
  )
}

export function Row({ label, children, hint, flag }: { label: ReactNode; children: ReactNode; hint?: ReactNode; flag?: boolean }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 py-0.5">
      <div className="min-w-0">
        <div className={`truncate text-[13px] ${flag ? 'text-warn font-medium' : 'text-ink2'}`}>{label}</div>
        {hint && <div className="text-[11px] text-ink3">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink3">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'; children: ReactNode }) {
  const c = tone === 'good' ? 'bg-goodsoft text-good' : tone === 'warn' ? 'bg-warnsoft text-warn' : tone === 'bad' ? 'bg-badsoft text-bad' : tone === 'accent' ? 'bg-accentsoft text-accent' : 'bg-fill text-ink2'
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${c}`}>{children}</span>
}

// ------------------------------------------------------------------ inputs
const inputBase = 'h-8 w-full rounded-lg border bg-fill px-2.5 text-right text-[13px] tabular-nums outline-none transition focus:border-accent focus:bg-solid'

export function TextInput({ value, onCommit, placeholder, className = '' }: { value: string; onCommit: (v: string) => void; placeholder?: string; className?: string }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <input
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setText(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      className={`h-8 w-full rounded-lg border border-transparent bg-fill px-2.5 text-[13px] outline-none transition focus:border-accent focus:bg-solid ${className}`}
    />
  )
}

/**
 * A length field. Shows the value in the project's units (fractions to 1/16"), accepts anything parseLength does
 * (7' 4 1/2", 88.5, 88 1/2, 224cm), and commits on Enter/blur. When `nullable`, clearing the field means "not measured".
 */
export function LengthInput({ value, onCommit, units, nullable = false, min = 0, placeholder, flag, width = 104, testId }: { value: number | null; onCommit: (v: number | null) => void; units: UnitSystem; nullable?: boolean; min?: number; placeholder?: string; flag?: boolean; width?: number; testId?: string }) {
  const show = (v: number | null) => (v === null ? '' : formatLength(v, { units, denom: 16 }))
  const [text, setText] = useState(show(value))
  const [bad, setBad] = useState<string | null>(null)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) {
      setText(show(value))
      setBad(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, units])

  const commit = () => {
    focused.current = false
    const t = text.trim()
    if (t === '') {
      if (nullable) {
        setBad(null)
        if (value !== null) onCommit(null)
      } else {
        setText(show(value))
        setBad(null)
      }
      return
    }
    const v = parseLength(t, { allowNegative: min < 0 })
    if (v === null) return setBad('Not a length. Try 88", 7\' 4", 88 1/2 or 224cm.')
    if (v < min) return setBad(min === 0 ? 'Must be 0 or more.' : `Must be at least ${formatLength(min, { units })}.`)
    setBad(null)
    setText(show(v))
    if (v !== value) onCommit(v)
  }
  return (
    <div style={{ width }} className="relative">
      <input
        data-testid={testId}
        value={text}
        inputMode="decimal"
        placeholder={placeholder ?? (nullable ? 'Not measured' : '')}
        onFocus={(e) => {
          focused.current = true
          e.currentTarget.select()
        }}
        onChange={(e) => {
          setText(e.target.value)
          setBad(null)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setText(show(value))
            setBad(null)
            focused.current = false
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        aria-invalid={bad !== null}
        title={bad ?? undefined}
        className={`${inputBase} ${bad ? 'border-bad' : flag ? 'border-[var(--warn)] bg-warnsoft' : 'border-transparent'} placeholder:text-ink3`}
      />
      {bad && <div className="absolute right-0 top-[34px] z-20 w-56 rounded-lg bg-solid p-2 text-left text-[11px] text-bad shadow-float border border-line">{bad}</div>}
    </div>
  )
}

export function NumInput({ value, onCommit, suffix, min, max, width = 84, step = 1, testId }: { value: number; onCommit: (v: number) => void; suffix?: string; min?: number; max?: number; width?: number; step?: number; testId?: string }) {
  const [text, setText] = useState(String(Math.round(value * 100) / 100))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(String(Math.round(value * 100) / 100))
  }, [value])
  const commit = () => {
    focused.current = false
    const n = parseFloat(text)
    if (!Number.isFinite(n)) return setText(String(Math.round(value * 100) / 100))
    const v = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
    setText(String(Math.round(v * 100) / 100))
    if (v !== value) onCommit(v)
  }
  return (
    <div style={{ width }} className="relative">
      <input
        data-testid={testId}
        value={text}
        inputMode="decimal"
        step={step}
        onFocus={(e) => {
          focused.current = true
          e.currentTarget.select()
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setText(String(value))
            focused.current = false
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className={`${inputBase} border-transparent ${suffix ? 'pr-6' : ''}`}
      />
      {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-ink3">{suffix}</span>}
    </div>
  )
}

export function Select<T extends string>({ value, onChange, options, width = 140, flag }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; disabled?: boolean }>; width?: number; flag?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} style={{ width }} className={`h-8 rounded-lg border bg-fill px-2 text-[13px] outline-none focus:border-accent ${flag ? 'border-[var(--warn)] bg-warnsoft' : 'border-transparent'}`}>
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function StatusDot({ status }: { status: 'good' | 'tight' | 'collision' | 'flush' }) {
  const c = status === 'collision' ? 'bg-bad' : status === 'tight' ? 'bg-warn' : 'bg-good'
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${c}`} style={{ background: status === 'tight' ? 'var(--warn)' : undefined }} />
}
