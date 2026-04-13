import path from 'node:path'
import { open } from 'lmdb'

const MAX_BOUNDS_SCAN = 500_000
const MAX_QUERY_ROWS = 20_000

export interface LmdbTimelineBoundsResult {
  minMs: number
  maxMs: number
  /** Entries for which a timeline could be inferred (key or value). */
  entryCount: number
  /** Total key/value pairs in the LMDB (via getCount). */
  totalDbEntries: number
  error?: string
}

export interface LmdbTimelineRow {
  timeMs: number
  keyStr: string
  value: unknown
}

export interface LmdbTimelineQueryResult {
  rows: LmdbTimelineRow[]
  truncated: boolean
  error?: string
}

function keyToLabel(key: unknown): string {
  if (typeof key === 'string') return key
  if (typeof key === 'number' || typeof key === 'bigint') return String(key)
  if (key instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(key))) {
    return Buffer.from(key).toString('utf8')
  }
  try {
    return JSON.stringify(key)
  } catch {
    return String(key)
  }
}

/** Roughly 1970–2262 in milliseconds (valid for typical sensor/log data). */
function isReasonableUnixMs(ms: number): boolean {
  return Number.isFinite(ms) && ms >= 0 && ms <= 1e13
}

/**
 * Interpret a string of digits as unix time (seconds, ms, μs, or ns).
 */
function epochDigitsToMs(digits: string): number | null {
  if (!/^\d+$/.test(digits)) return null
  const n = Number(digits)
  if (!Number.isFinite(n)) return null
  const len = digits.length
  // Seconds (typ. 10 digits until ~2286)
  if (len <= 10) {
    const ms = n * 1000
    return isReasonableUnixMs(ms) ? ms : null
  }
  // Milliseconds (13 digits is typical now)
  if (len <= 13) {
    return isReasonableUnixMs(n) ? n : null
  }
  // Microseconds (often 16 digits)
  if (len <= 16) {
    const ms = Math.floor(n / 1000)
    return isReasonableUnixMs(ms) ? ms : null
  }
  // Nanoseconds or larger
  const ms = Math.floor(n / 1_000_000)
  return isReasonableUnixMs(ms) ? ms : null
}

function tryParseFromBinaryKey(key: unknown): number | null {
  if (!(key instanceof Uint8Array) && !(typeof Buffer !== 'undefined' && Buffer.isBuffer(key))) {
    return null
  }
  const buf = Buffer.from(key as Uint8Array)
  if (buf.length === 8) {
    try {
      const v = Number(buf.readBigUInt64BE(0))
      if (isReasonableUnixMs(v)) return v
    } catch {
      /* ignore */
    }
    try {
      const v = Number(buf.readBigUInt64LE(0))
      if (isReasonableUnixMs(v)) return v
    } catch {
      /* ignore */
    }
  }
  if (buf.length === 4) {
    const sec = buf.readUInt32BE(0)
    if (sec > 1_000_000_000 && sec < 5_000_000_000) return sec * 1000
    const secLe = buf.readUInt32LE(0)
    if (secLe > 1_000_000_000 && secLe < 5_000_000_000) return secLe * 1000
  }
  return null
}

/**
 * Parse LMDB key into UTC milliseconds.
 * Supports: plain epoch (sec/ms/μs/ns), ISO-8601, prefixed/composite keys with embedded epoch or ISO,
 * and binary uint32 (seconds) / uint64 (ms) big/little endian.
 */
export function parseTimelineKeyMs(key: unknown): number | null {
  const fromBin = tryParseFromBinaryKey(key)
  if (fromBin !== null) return fromBin

  const label = keyToLabel(key).trim()
  if (!label) return null

  // Whole string: digits only
  const wholeDigits = epochDigitsToMs(label)
  if (wholeDigits !== null) return wholeDigits

  // Whole string: ISO / RFC3339
  const wholeDate = Date.parse(label)
  if (!Number.isNaN(wholeDate) && isReasonableUnixMs(wholeDate)) return wholeDate

  // Embedded ISO-like fragment (e.g. "sensor/A/2024-01-15T12:00:00.000Z/extra")
  const isoRe =
    /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/
  const isoMatch = label.match(isoRe)
  if (isoMatch) {
    const d = Date.parse(isoMatch[0])
    if (!Number.isNaN(d) && isReasonableUnixMs(d)) return d
  }

  // Embedded epoch runs: take longest matches first (device_1704067200000_slot)
  const runs = label.match(/\d{10,19}/g)
  if (runs) {
    const sorted = [...new Set(runs)].sort((a, b) => b.length - a.length)
    for (const run of sorted) {
      const t = epochDigitsToMs(run)
      if (t !== null) return t
    }
  }

  // Float seconds in string: "1704067200.123"
  const floatSec = label.match(/\b(\d{9,12})\.(\d{1,6})\b/)
  if (floatSec) {
    const sec = parseFloat(`${floatSec[1]}.${floatSec[2]}`)
    if (sec > 1e9 && sec < 2e10) {
      const ms = Math.floor(sec * 1000)
      if (isReasonableUnixMs(ms)) return ms
    }
  }

  // JSON array key string e.g. "[1704067200000,0]"
  if (label.startsWith('[')) {
    try {
      const parsed = JSON.parse(label) as unknown
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0]
        if (typeof first === 'number' && isReasonableUnixMs(first)) return first
        if (typeof first === 'string') {
          const t = epochDigitsToMs(first) ?? (Date.parse(first) || NaN)
          if (!Number.isNaN(t) && isReasonableUnixMs(t)) return t
        }
      }
    } catch {
      /* ignore */
    }
  }

  return null
}

function inferEntryTimeMsFromDecoded(key: unknown, decoded: unknown): number | null {
  const pk = parseTimelineKeyMs(key)
  if (pk !== null) return pk
  return inferTimeFromDecodedValue(decoded)
}

function decodeValue(value: unknown): unknown {
  if (value == null) return null
  if (typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    return value
  }
  const buf = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value)
      : null
  const s = buf ? buf.toString('utf8') : String(value)
  try {
    return JSON.parse(s) as unknown
  } catch {
    return s
  }
}

const VALUE_TIME_KEYS = [
  'timestamp',
  'time',
  'ts',
  't',
  'at',
  'createdAt',
  'created_at',
  'updatedAt',
  'updated_at',
  'ms',
  'epoch'
] as const

/**
 * When the LMDB key is not a time (e.g. UUID), use a numeric or ISO field from JSON payload.
 */
export function inferTimeFromDecodedValue(decoded: unknown): number | null {
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    return null
  }
  const o = decoded as Record<string, unknown>
  for (const k of VALUE_TIME_KEYS) {
    const x = o[k]
    if (typeof x === 'number' && Number.isFinite(x)) {
      if (isReasonableUnixMs(x)) return x
      // Unix seconds (common in APIs)
      if (x > 1e9 && x < 1e11) return Math.floor(x * 1000)
    }
    if (typeof x === 'string') {
      const d = Date.parse(x)
      if (!Number.isNaN(d) && isReasonableUnixMs(d)) return d
      const e = epochDigitsToMs(x.trim())
      if (e !== null) return e
    }
  }
  return null
}

export async function getLmdbTimelineBounds(dbPath: string): Promise<LmdbTimelineBoundsResult> {
  const absPath = path.resolve(dbPath.trim())
  let minMs = Number.POSITIVE_INFINITY
  let maxMs = Number.NEGATIVE_INFINITY
  let entryCount = 0
  let scanned = 0

  let totalDbEntries = 0

  try {
    const db = open(absPath, { readOnly: true })
    try {
      try {
        totalDbEntries = db.getCount()
      } catch {
        totalDbEntries = 0
      }
      for (const { key, value } of db.getRange({})) {
        scanned++
        if (scanned > MAX_BOUNDS_SCAN) break
        const t = inferEntryTimeMsFromDecoded(key, decodeValue(value))
        if (t === null) continue
        entryCount++
        if (t < minMs) minMs = t
        if (t > maxMs) maxMs = t
      }
    } finally {
      await db.close()
    }
  } catch (e) {
    return {
      minMs: 0,
      maxMs: 0,
      entryCount: 0,
      totalDbEntries: 0,
      error: e instanceof Error ? e.message : String(e)
    }
  }

  if (entryCount === 0 || !Number.isFinite(minMs) || !Number.isFinite(maxMs)) {
    return {
      minMs: Date.now(),
      maxMs: Date.now(),
      entryCount: 0,
      totalDbEntries,
      error:
        'No time found in keys or values. Keys: epoch/ISO fragments, binary uint32/uint64, JSON arrays. Values: JSON with timestamp, ts, time, t, at, createdAt, etc.'
    }
  }

  return { minMs, maxMs, entryCount, totalDbEntries }
}

export async function queryLmdbTimelineRange(
  dbPath: string,
  startMs: number,
  endMs: number
): Promise<LmdbTimelineQueryResult> {
  const lo = Math.min(startMs, endMs)
  const hi = Math.max(startMs, endMs)
  const absPath = path.resolve(dbPath.trim())
  const rows: LmdbTimelineRow[] = []
  let truncated = false

  try {
    const db = open(absPath, { readOnly: true })
    try {
      for (const { key, value } of db.getRange({})) {
        const decoded = decodeValue(value)
        const timeMs = inferEntryTimeMsFromDecoded(key, decoded)
        if (timeMs === null) continue
        if (timeMs < lo || timeMs > hi) continue
        rows.push({
          timeMs,
          keyStr: keyToLabel(key),
          value: decoded
        })
        if (rows.length >= MAX_QUERY_ROWS) {
          truncated = true
          break
        }
      }
    } finally {
      await db.close()
    }
  } catch (e) {
    return {
      rows: [],
      truncated: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }

  rows.sort((a, b) => a.timeMs - b.timeMs)
  return { rows, truncated }
}
