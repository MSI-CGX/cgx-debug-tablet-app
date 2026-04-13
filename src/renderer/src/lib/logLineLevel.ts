/**
 * Heuristic log line levels for typical application logs (info / warn / debug / error, etc.).
 */

export type LogLineLevel = 'error' | 'warn' | 'info' | 'debug' | 'other'

export const LOG_LEVEL_ORDER: LogLineLevel[] = ['error', 'warn', 'info', 'debug', 'other']

export const DEFAULT_LOG_LEVEL_VISIBILITY: Record<LogLineLevel, boolean> = {
  error: true,
  warn: true,
  info: true,
  debug: true,
  other: true
}

/**
 * Classify a single line. Order of checks matters (e.g. "warning" before generic tokens).
 */
export function detectLogLineLevel(line: string): LogLineLevel {
  const s = line.replace(/\r/g, '')
  if (/\b(fatal|critical)\b/i.test(s)) return 'error'
  if (/\berror\b/i.test(s)) return 'error'
  if (/\bwarn(ing)?\b/i.test(s)) return 'warn'
  if (/\binfo\b/i.test(s)) return 'info'
  if (/\b(debug|trace|verbose)\b/i.test(s)) return 'debug'
  return 'other'
}

/**
 * Keep only lines whose detected level is enabled in `visibility`.
 */
export function filterLogContentByLevels(
  content: string,
  visibility: Record<LogLineLevel, boolean>
): string {
  const lines = content.split('\n')
  const kept = lines.filter((line) => visibility[detectLogLineLevel(line)])
  return kept.join('\n')
}
