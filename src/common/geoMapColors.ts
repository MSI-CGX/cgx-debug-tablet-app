/** Default palette when `mapColor` is unset (same order as map rendering). */
export const GEO_MAP_DEFAULT_LAYER_COLORS = [
  '#3388ff',
  '#e63e3e',
  '#2ecc71',
  '#9b59b6',
  '#f39c12',
  '#1abc9c'
] as const

const HEX_3_OR_6 = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Returns normalized `#rrggbb` or `undefined` when empty / invalid (use palette default).
 */
export function normalizeMapColorHex(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined
  const s = String(raw).trim()
  if (s === '') return undefined
  if (!HEX_3_OR_6.test(s)) return undefined
  if (s.length === 4) {
    const r = s[1]!
    const g = s[2]!
    const b = s[3]!
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return s.toLowerCase()
}

/** Deterministic “random” HSL stroke for line geometries (stable for a given layer + geometry). */
export function lineStrokeColorFromGeometry(layerId: string, geometry: unknown): string {
  const seed = `${layerId}\0${JSON.stringify(geometry)}`
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const hue = (h >>> 0) % 360
  return `hsl(${hue} 72% 52%)`
}
