import { randomUUID } from 'node:crypto'
import path from 'path'
import type Store from 'electron-store'
import type { AppStoreSchema, FavoriteEntry, FileReadMode, GeoJsonMapLayerEntry } from './appStore'
import { normalizeMapColorHex } from '../common/geoMapColors'
import {
  DEFAULT_GEO_MAP_CONTROL_POSITION,
  normalizeGeoMapControlPosition
} from '../common/geoMapControlPosition'
import { normalizeGeoMapIconId } from '../common/geoMapIcons'
import { normalizeStoredRel, toWorkspaceRelative } from './workspacePaths'

/**
 * One-time migrations: fileDbBindings keys (strip absolute root).
 */
export function runStoreMigrations(appStore: Store<AppStoreSchema>): void {
  migrateFileDbBindings(appStore)
  migrateLmdbTimelineKeyRules(appStore)
  migrateGeoJsonMapToolbarPosition(appStore)
  migrateGeoJsonMapLayerIcons(appStore)
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

/** Ensure each GeoJSON map layer has valid `mapIcon` and optional `mapColor`. */
function migrateGeoJsonMapLayerIcons(appStore: Store<AppStoreSchema>): void {
  const raw = appStore.get('geoJsonMapLayers', [])
  if (!Array.isArray(raw) || raw.length === 0) {
    return
  }
  let changed = false
  const next = (raw as GeoJsonMapLayerEntry[]).map((item) => {
    const icon = normalizeGeoMapIconId(item?.mapIcon)
    const color = normalizeMapColorHex(item?.mapColor)
    if (item?.mapIcon !== icon) {
      changed = true
    }
    if (color) {
      if (item?.mapColor !== color) {
        changed = true
      }
    } else if (item?.mapColor) {
      changed = true
    }
    const out: GeoJsonMapLayerEntry = { ...item, mapIcon: icon }
    if (color) {
      out.mapColor = color
    } else {
      delete out.mapColor
    }
    return out
  })
  if (changed) {
    appStore.set('geoJsonMapLayers', next)
  }
}

/**
 * Toolbar edge is global (one control strip). Migrate from legacy per-layer `mapControlPosition`
 * and strip that field from stored layers.
 */
function migrateGeoJsonMapToolbarPosition(appStore: Store<AppStoreSchema>): void {
  const raw = appStore.get('geoJsonMapLayers', [])
  if (!appStore.has('geoJsonMapToolbarPosition')) {
    let pos = DEFAULT_GEO_MAP_CONTROL_POSITION
    if (Array.isArray(raw) && raw.length > 0) {
      const first = raw[0] as GeoJsonMapLayerEntry & { mapControlPosition?: string }
      pos = normalizeGeoMapControlPosition(first?.mapControlPosition)
    }
    appStore.set('geoJsonMapToolbarPosition', pos)
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return
  }
  let stripChanged = false
  const stripped = (raw as (GeoJsonMapLayerEntry & { mapControlPosition?: string })[]).map(
    (item) => {
      if (item.mapControlPosition !== undefined) {
        stripChanged = true
      }
      const { mapControlPosition: _drop, ...rest } = item
      return rest as GeoJsonMapLayerEntry
    }
  )
  if (stripChanged) {
    appStore.set('geoJsonMapLayers', stripped)
  }
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
