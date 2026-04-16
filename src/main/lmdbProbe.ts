import { open, stat } from 'fs/promises'
import path from 'node:path'

/** Enough for the first LMDB meta page (typical page size 4–64 KiB; magic is inside page 0). */
const PROBE_BYTES = 65_536

/** LMDB on-disk meta `mm_magic` (see OpenLDAP `mdb.c`, little-endian). */
const MDB_MAGIC_LE = 0xbeefc0de

/** Standard data file inside an LMDB environment directory. */
const LMDB_DATA_FILE = 'data.mdb'

export type LmdbRefusalReason = 'looks_like_json_text' | 'not_lmdb_format'

function bufferLooksLikeJsonText(buf: Buffer): boolean {
  let s = buf.toString('utf8')
  if (s.charCodeAt(0) === 0xfeff) {
    s = s.slice(1)
  }
  s = s.trimStart()
  if (s.length === 0) {
    return false
  }
  const c = s[0]
  return c === '{' || c === '['
}

/** True if `buf` contains the LMDB meta magic (scan every byte; meta page offset varies). */
function bufferHasLmdbMetaMagic(buf: Buffer): boolean {
  const max = buf.length - 4
  for (let i = 0; i <= max; i++) {
    if (buf.readUInt32LE(i) === MDB_MAGIC_LE) {
      return true
    }
  }
  return false
}

async function probeFileHead(absFile: string): Promise<LmdbRefusalReason | null> {
  let st
  try {
    st = await stat(absFile)
  } catch {
    return 'not_lmdb_format'
  }
  if (!st.isFile() || st.size === 0) {
    return 'not_lmdb_format'
  }

  const fh = await open(absFile, 'r')
  try {
    const len = Math.min(PROBE_BYTES, st.size)
    const buf = Buffer.alloc(len)
    const { bytesRead } = await fh.read(buf, 0, len, 0)
    const slice = buf.subarray(0, bytesRead)
    if (bufferLooksLikeJsonText(slice)) {
      return 'looks_like_json_text'
    }
    if (!bufferHasLmdbMetaMagic(slice)) {
      return 'not_lmdb_format'
    }
  } finally {
    await fh.close()
  }
  return null
}

/**
 * If we should not call `lmdb.open()` on this path (avoids native crashes on non-LMDB paths).
 * Directories must contain a valid `data.mdb` with LMDB magic; files are probed directly.
 */
export async function getLmdbRefusalReason(
  absPath: string
): Promise<LmdbRefusalReason | null> {
  const resolved = path.resolve(absPath.trim())
  let st
  try {
    st = await stat(resolved)
  } catch {
    return null
  }
  if (st.isDirectory()) {
    const dataMdb = path.join(resolved, LMDB_DATA_FILE)
    return probeFileHead(dataMdb)
  }
  if (!st.isFile() || st.size === 0) {
    return 'not_lmdb_format'
  }

  return probeFileHead(resolved)
}
