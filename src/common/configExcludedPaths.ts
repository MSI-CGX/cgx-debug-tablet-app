/**
 * One JSON path segment: object key, array index, or `*` (wildcard matching exactly one segment).
 */
export type JsonPathSegment = string | number | '*'

/**
 * Dot-separated path for JSON (e.g. auth.apiKey, items.0.name). Numeric segments are array indices.
 * A literal `*` segment is the wildcard for one path segment.
 */
export function pathSegmentsToDottedKey(
  segments: readonly JsonPathSegment[]
): string {
  if (segments.length === 0) return ''
  return segments.map((s) => String(s)).join('.')
}

/**
 * Parse a dotted path from Settings. Segments that are all digits are treated as array indices.
 * A segment exactly `*` is a wildcard (one segment).
 */
export function parseDottedPath(raw: string): JsonPathSegment[] | null {
  const t = raw.trim().replace(/^\.+|\.+$/g, '')
  if (!t) return null
  const parts = t.split('.').filter((p) => p.length > 0)
  if (parts.length === 0) return null
  const out: JsonPathSegment[] = []
  for (const p of parts) {
    if (p === '*') {
      out.push('*')
    } else if (/^\d+$/.test(p)) {
      out.push(parseInt(p, 10))
    } else {
      out.push(p)
    }
  }
  return out
}

export function normalizeExcludedPathLine(raw: string): string | null {
  const segments = parseDottedPath(raw)
  if (!segments || segments.length === 0) return null
  return pathSegmentsToDottedKey(segments)
}

export function normalizeExcludedPathList(lines: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of lines) {
    const n = normalizeExcludedPathLine(String(item))
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  out.sort((a, b) => a.localeCompare(b))
  return out
}

/**
 * True when `path` matches `pattern` segment-wise; `*` matches any single segment (object key or index).
 */
export function matchPathToPattern(
  path: readonly (string | number)[],
  pattern: readonly JsonPathSegment[]
): boolean {
  if (pattern.length !== path.length) return false
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!
    const s = path[i]!
    if (p === '*') continue
    if (typeof p === 'number' && typeof s === 'number' && p === s) continue
    if (String(p) === String(s)) continue
    return false
  }
  return true
}

/**
 * Whether this node path is excluded by any rule (exact dotted path or pattern with `*`).
 */
export function isPathExcludedByRules(
  path: readonly (string | number)[],
  excludedLines: readonly string[]
): boolean {
  const dotted = pathSegmentsToDottedKey(path)
  for (const line of excludedLines) {
    const n = normalizeExcludedPathLine(String(line))
    if (!n) continue
    if (!n.includes('*')) {
      if (n === dotted) return true
    } else {
      const pat = parseDottedPath(n)
      if (pat && matchPathToPattern(path, pat)) return true
    }
  }
  return false
}
