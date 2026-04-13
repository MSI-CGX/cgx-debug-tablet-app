import type { LogHighlightRule } from '../../../preload/types'
import type { LogLineLevel } from './logLineLevel'

/**
 * Returns the color for the first rule whose `match` is a substring of `line` (in order).
 * Matching is case-insensitive; CR from Windows line endings is ignored for matching.
 */
export function colorForLogLine(line: string, rules: LogHighlightRule[]): string | undefined {
  const normalized = line.replace(/\r/g, '')
  const lineLower = normalized.toLowerCase()
  for (const r of rules) {
    if (!r.match) continue
    const needle = r.match.replace(/\r/g, '')
    if (lineLower.includes(needle.toLowerCase())) {
      return r.color
    }
  }
  return undefined
}

/** Sample lines aligned with Settings log rules (FATAL, ERROR, WARN, …) so filter chips use the same colors. */
const LOG_FILTER_LEVEL_SAMPLES: Record<Exclude<LogLineLevel, 'other'>, string[]> = {
  error: ['FATAL', 'ERROR', 'fatal', 'error'],
  warn: ['WARN', 'warn', 'warning'],
  info: ['INFO', 'info'],
  debug: ['DEBUG', 'debug', 'trace', 'verbose']
}

/**
 * Accent color for a log-level filter toggle, derived from the same rules as log line highlighting.
 */
export function colorForLogFilterLevel(
  level: LogLineLevel,
  rules: LogHighlightRule[]
): string | undefined {
  if (level === 'other') return undefined
  for (const sample of LOG_FILTER_LEVEL_SAMPLES[level]) {
    const c = colorForLogLine(sample, rules)
    if (c) return c
  }
  return undefined
}

function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.trim()
  if (h.startsWith('#')) h = h.slice(1)
  if (h.length === 3) {
    h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!
  }
  if (h.length !== 6 || !/^[0-9a-f]+$/i.test(h)) return null
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/**
 * Readable foreground on a solid accent (hex) for filter buttons.
 */
export function foregroundOnAccent(backgroundCssColor: string): string {
  const rgb = parseHexRgb(backgroundCssColor)
  if (!rgb) return '#e8eaed'
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const r = lin(rgb.r)
  const g = lin(rgb.g)
  const b = lin(rgb.b)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.45 ? '#0f1115' : '#f0f2f5'
}
