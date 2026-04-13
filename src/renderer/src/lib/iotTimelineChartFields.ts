/**
 * Discover numeric JSON paths (dot notation) for IoT timeline chart series.
 */

const MAX_SAMPLE_ROWS = 500

export function getNumericAtPath(root: unknown, path: string): number | null {
  const parts = path.split('.').filter(Boolean)
  let cur: unknown = root
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return null
    cur = (cur as Record<string, unknown>)[p]
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : null
}

function walkNumericPaths(
  node: unknown,
  prefix: string,
  depth: number,
  maxDepth: number,
  out: Set<string>
): void {
  if (depth > maxDepth || node === null || typeof node !== 'object' || Array.isArray(node)) {
    return
  }
  for (const [k, val] of Object.entries(node)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (typeof val === 'number' && Number.isFinite(val)) {
      out.add(p)
    } else if (val !== null && typeof val === 'object' && !Array.isArray(val) && depth < maxDepth) {
      walkNumericPaths(val, p, depth + 1, maxDepth, out)
    }
  }
}

/**
 * Collect sorted unique dot-paths to finite numbers in row payloads.
 */
export function collectNumericFieldPaths(rows: { value: unknown }[], maxDepth = 2): string[] {
  const out = new Set<string>()
  for (const row of rows.slice(0, MAX_SAMPLE_ROWS)) {
    walkNumericPaths(row.value, '', 0, maxDepth, out)
  }
  return [...out].sort((a, b) => a.localeCompare(b))
}

/** Safe object key for Recharts dataKey (no dots). */
export function seriesDataKey(path: string): string {
  return `s_${path.replace(/[^a-zA-Z0-9]/g, '_')}`
}
