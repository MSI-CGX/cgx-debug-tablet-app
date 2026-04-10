import path from 'node:path'

function keyToLabel(key: unknown): string {
  if (typeof key === 'string') return key
  if (key instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(key))) {
    return Buffer.from(key).toString('utf8')
  }
  try {
    return JSON.stringify(key)
  } catch {
    return String(key)
  }
}

export async function sampleLmdbKeys(
  dbPath: string,
  limit = 40
): Promise<{ keys: string[]; error?: string }> {
  const trimmed = dbPath.trim()
  if (!trimmed) {
    return { keys: [] }
  }

  const absPath = path.resolve(trimmed)

  try {
    const { open } = await import('lmdb')
    const db = open(absPath, {
      readOnly: true
    })
    const keys: string[] = []
    try {
      for (const { key } of db.getRange({ limit })) {
        keys.push(keyToLabel(key))
      }
    } finally {
      await db.close()
    }
    return { keys }
  } catch (e) {
    return { keys: [], error: e instanceof Error ? e.message : String(e) }
  }
}
