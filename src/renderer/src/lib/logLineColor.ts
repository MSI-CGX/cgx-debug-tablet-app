import type { LogHighlightRule } from '../../../preload/types'

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
