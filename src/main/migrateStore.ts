import { randomUUID } from 'node:crypto'
import path from 'path'
import type Store from 'electron-store'
import type { AppStoreSchema, FavoriteEntry, FileReadMode } from './appStore'
import { normalizeStoredRel, toWorkspaceRelative } from './workspacePaths'

/**
 * One-time migrations: fileDbBindings keys (strip absolute root).
 */
export function runStoreMigrations(appStore: Store<AppStoreSchema>): void {
  migrateFileDbBindings(appStore)
  migrateLmdbTimelineKeyRules(appStore)
}

/** Copy legacy single `lmdbPath` + `lmdbTimelineKeyRegex` into the rules list. */
function migrateLmdbTimelineKeyRules(appStore: Store<AppStoreSchema>): void {
  const existing = appStore.get('lmdbTimelineKeyRules', [])
  if (Array.isArray(existing) && existing.length > 0) {
    return
  }
  const legacyPath = appStore.get('lmdbPath', '').trim()
  const legacyRegex = appStore.get('lmdbTimelineKeyRegex', '').trim()
  if (legacyPath && legacyRegex) {
    appStore.set('lmdbTimelineKeyRules', [
      { id: randomUUID(), lmdbPath: legacyPath, keyRegex: legacyRegex }
    ])
  }
}

/**
 * Rewrite favorites to workspace-relative entries (call after workspace root is set).
 */
export function migrateFavorites(appStore: Store<AppStoreSchema>): void {
  const wr = appStore.get('workspaceRoot', '').trim()
  if (!wr) return
  const next = normalizeFavoritesArray(wr, appStore.get('favorites', []))
  appStore.set('favorites', next)
}

/** Resolve stored favorites (relative and legacy absolute) for the current workspace root. */
export function normalizeFavoritesArray(
  workspaceRoot: string,
  raw: unknown[]
): FavoriteEntry[] {
  const wr = workspaceRoot.trim()
  if (!wr) return []
  const out: FavoriteEntry[] = []
  for (const item of raw as (FavoriteEntry & { absolutePath?: string })[]) {
    if (item.relativePath && typeof item.relativePath === 'string') {
      out.push({
        id: item.id,
        label: item.label,
        relativePath: normalizeStoredRel(item.relativePath)
      })
      continue
    }
    if (item.absolutePath) {
      const rel = toWorkspaceRelative(wr, path.normalize(path.resolve(item.absolutePath)))
      if (rel !== null) {
        out.push({
          id: item.id,
          label: item.label,
          relativePath: normalizeStoredRel(rel)
        })
      }
    }
  }
  return out
}

function migrateFileDbBindings(appStore: Store<AppStoreSchema>): void {
  const raw = appStore.get('fileDbBindings', {})
  const next: Record<string, Exclude<FileReadMode, 'plain'>> = {}
  let changed = false
  for (const [k, v] of Object.entries(raw)) {
    if (!k.includes('|')) {
      const norm = k.replace(/\\/g, '/')
      const base = path.basename(norm).toLowerCase()
      if (v === 'lmdb' && base.endsWith('.geojson')) {
        changed = true
        continue
      }
      next[norm] = v
      if (norm !== k) changed = true
      continue
    }
    const idx = k.indexOf('|')
    const rel = k.slice(idx + 1).replace(/\\/g, '/')
    const base = path.basename(rel).toLowerCase()
    if (v === 'lmdb' && base.endsWith('.geojson')) {
      changed = true
      continue
    }
    next[rel] = v
    changed = true
  }
  if (changed) {
    appStore.set('fileDbBindings', next)
  }
}
