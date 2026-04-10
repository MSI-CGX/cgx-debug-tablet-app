import Store from 'electron-store'

export type AppLocale = 'en' | 'fr'

/**
 * Preview mode for files/folders. `plain` is only resolved (never stored);
 * stored overrides use text / image / encrypted / lmdb.
 */
export type FileReadMode =
  | 'plain'
  | 'text'
  | 'image'
  | 'electron-store-encrypted'
  | 'lmdb'

/** Default preview for file extensions (Settings). Keys without leading dot, lowercased. */
export type ExtensionPreviewKind = 'text' | 'image'

const DEFAULT_EXTENSION_PREVIEW_MAP: Record<string, ExtensionPreviewKind> = {
  avif: 'image',
  bmp: 'image',
  gif: 'image',
  ico: 'image',
  jpeg: 'image',
  jpg: 'image',
  png: 'image',
  svg: 'image',
  webp: 'image'
}

/** Substring match (first matching rule wins) → CSS color for log preview. */
export interface LogHighlightRule {
  id: string
  match: string
  color: string
}

/** Shortcut in the header; path is relative to {@link AppStoreSchema.workspaceRoot}. */
export interface FavoriteEntry {
  id: string
  /** Path under workspace root (forward slashes in storage). */
  relativePath: string
  /** Button label; usually the file/folder base name. */
  label: string
}

/** GeoJSON file registered for the Leaflet map (path relative to workspace root). */
export interface GeoJsonMapLayerEntry {
  id: string
  relativePath: string
  label: string
}

export const DEFAULT_LOG_HIGHLIGHT_RULES: LogHighlightRule[] = [
  { id: 'log-d1', match: 'FATAL', color: '#ff5555' },
  { id: 'log-d2', match: 'ERROR', color: '#f48771' },
  { id: 'log-d3', match: 'WARN', color: '#cca700' },
  { id: 'log-d4', match: 'INFO', color: '#89d185' },
  { id: 'log-d5', match: 'DEBUG', color: '#6796e6' }
]

export interface AppStoreSchema {
  /**
   * Registered workspace folder ("search base"). Set when the user picks a folder via Open folder.
   * Paths in favorites, file preview bindings, and LMDB (when relative) resolve against this root.
   */
  workspaceRoot: string
  /** Folder base names hidden in the sidebar (any depth). */
  ignoredFolderNames: string[]
  /** File extensions hidden in the sidebar (no leading dot, lowercased). */
  ignoredFileExtensions: string[]
  /** LMDB path: absolute, or relative to {@link workspaceRoot} when not absolute. */
  lmdbPath: string
  /** UI language for renderer and native menus that read from store. */
  locale: AppLocale
  /**
   * Per-entry read mode (files and folders): key = relative path under workspace with `/` separators.
   * Absent keys use extensionPreviewMap for files, plain for folders.
   */
  fileDbBindings: Record<string, Exclude<FileReadMode, 'plain'>>
  /**
   * File extension → preview kind. Merged with built-in defaults for missing keys.
   */
  extensionPreviewMap: Record<string, ExtensionPreviewKind>
  /** When true, log line highlight rules apply to any text preview, not only `.log` files. */
  logHighlightForAllTextFiles: boolean
  /** Ordered rules: first substring match on a line wins. */
  logHighlightRules: LogHighlightRule[]
  /** Quick-open shortcuts (paths relative to workspace root). */
  favorites: FavoriteEntry[]
  /** GeoJSON layers shown on the map window (paths relative to workspace root). */
  geoJsonMapLayers: GeoJsonMapLayerEntry[]
}

export const appStore = new Store<AppStoreSchema>({
  name: 'config',
  defaults: {
    workspaceRoot: '',
    ignoredFolderNames: [],
    ignoredFileExtensions: [],
    lmdbPath: '',
    locale: 'en',
    fileDbBindings: {},
    extensionPreviewMap: { ...DEFAULT_EXTENSION_PREVIEW_MAP },
    logHighlightForAllTextFiles: false,
    logHighlightRules: [...DEFAULT_LOG_HIGHLIGHT_RULES],
    favorites: [],
    geoJsonMapLayers: []
  }
})

export function getDefaultExtensionPreviewMap(): Record<string, ExtensionPreviewKind> {
  return { ...DEFAULT_EXTENSION_PREVIEW_MAP }
}

export function getIgnoredFolderNameSet(): Set<string> {
  return new Set(appStore.get('ignoredFolderNames', []))
}

export function getIgnoredFileExtensionSet(): Set<string> {
  return new Set(appStore.get('ignoredFileExtensions', []))
}
