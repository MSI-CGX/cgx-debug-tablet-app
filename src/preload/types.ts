export type EntryKind = 'file' | 'directory'

/**
 * Resolved preview mode. `plain` is default UTF-8 text (omitted in API when default).
 */
export type FileReadMode =
  | 'plain'
  | 'text'
  | 'image'
  | 'electron-store-encrypted'
  | 'lmdb'

export type ExtensionPreviewKind = 'text' | 'image'

/** Substring match (first match wins) → color for log line highlighting. */
export interface LogHighlightRule {
  id: string
  match: string
  color: string
}

/** Quick-open shortcut; path is relative to the registered workspace folder. */
export interface FavoriteEntry {
  id: string
  relativePath: string
  label: string
}

export interface GeoJsonMapLayerEntry {
  id: string
  relativePath: string
  label: string
}

export type FavoriteOpenResult =
  | {
      ok: true
      rootPath: string
      relativeDir: string
      selectRelativePath: string | null
    }
  | { ok: false; error: string }

export interface FolderEntry {
  name: string
  /** Path relative to the opened root folder (native separators). */
  relativePath: string
  kind: EntryKind
  /** Only set for files. */
  size?: number
  /** Resolved preview mode; omitted when plain default. */
  readMode?: FileReadMode
}

export type AppLocale = 'en' | 'fr'

export interface ConfigSnapshot {
  storePath: string
  /** Registered workspace root (set when opening a folder via the explorer). */
  workspaceRoot: string
  ignoredFolderNames: string[]
  /** Extensions to hide in the explorer (no dot, lowercased). */
  ignoredFileExtensions: string[]
  /** Stored LMDB path (absolute or relative to workspace root). */
  lmdbPath: string
  locale: AppLocale
  /** True when STORE_KEY is set in the environment (e.g. `.env`). */
  hasStoreKey: boolean
  /** Merged built-in defaults with user overrides (extension → text or image). */
  extensionPreviewMap: Record<string, ExtensionPreviewKind>
  /** Apply log highlight rules to every text file, not only `.log`. */
  logHighlightForAllTextFiles: boolean
  logHighlightRules: LogHighlightRule[]
  favorites: FavoriteEntry[]
  geoJsonMapLayers: GeoJsonMapLayerEntry[]
}

export interface LmdbPreviewResult {
  keys: string[]
  error?: string
}

export interface ImagePreviewResult {
  dataBase64: string
  mime: string
}

export interface AppAPI {
  openFolder: () => Promise<string | null>
  listFolderContents: (rootPath: string, relativeDir?: string) => Promise<FolderEntry[]>
  readFileText: (rootPath: string, relativePath: string) => Promise<string>
  readImagePreview: (rootPath: string, relativePath: string) => Promise<ImagePreviewResult>
  setFileReadMode: (
    rootPath: string,
    relativePath: string,
    mode: Exclude<FileReadMode, 'plain'> | 'default'
  ) => Promise<void>
  showFolderContextMenu: (
    rootPath: string,
    relativePath: string,
    screenX: number,
    screenY: number
  ) => void
  showFileContextMenu: (
    rootPath: string,
    relativePath: string,
    screenX: number,
    screenY: number
  ) => void
  subscribeIgnoredFoldersChanged: (handler: () => void) => () => void
  subscribeFileBindingsChanged: (handler: () => void) => () => void
  getConfigSnapshot: () => Promise<ConfigSnapshot>
  removeIgnoredFolderName: (name: string) => Promise<void>
  clearAllIgnoredFolderNames: () => Promise<void>
  setIgnoredFileExtensions: (extensions: string[]) => Promise<void>
  setLmdbPath: (path: string) => Promise<void>
  setExtensionPreviewMap: (map: Record<string, ExtensionPreviewKind>) => Promise<void>
  resetExtensionDefaults: () => Promise<void>
  setLogHighlightRules: (payload: {
    rules: LogHighlightRule[]
    forAllTextFiles: boolean
  }) => Promise<void>
  resetLogHighlightRules: () => Promise<void>
  subscribeLogRulesChanged: (handler: () => void) => () => void
  previewLmdb: (overridePath?: string) => Promise<LmdbPreviewResult>
  /** Preview LMDB keys for a path under the opened root folder. */
  previewLmdbAt: (rootPath: string, relativePath: string) => Promise<LmdbPreviewResult>
  setLocale: (locale: AppLocale) => Promise<void>
  subscribeLocaleChanged: (handler: (locale: AppLocale) => void) => () => void
  openFavorite: (id: string) => Promise<FavoriteOpenResult>
  removeFavorite: (id: string) => Promise<void>
  showFavoriteContextMenu: (id: string, screenX: number, screenY: number) => void
  subscribeFavoritesChanged: (handler: () => void) => () => void
  openMapWindow: () => void
  readGeoJsonFileText: (
    relativePath: string
  ) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
  removeGeoJsonMapLayer: (id: string) => Promise<void>
  subscribeGeoJsonMapLayersChanged: (handler: () => void) => () => void
}
