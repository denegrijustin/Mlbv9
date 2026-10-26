let counter = 0

/** Short unique id. Uses crypto.randomUUID when available. */
export function newId(prefix = ''): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  const base = c?.randomUUID ? c.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10) + (counter++).toString(36)
  return prefix ? `${prefix}-${base}` : base
}
