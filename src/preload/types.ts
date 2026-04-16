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

/** LMDB file pattern → regex for parsing timestamps from keys (timeline). */
export interface LmdbTimelineKeyRule {
  id: string
  lmdbPath: string
  keyRegex: string
}

export interface ConfigSnapshot {
  storePath: string
  /** Registered workspace root (set when opening a folder via the explorer). */
  workspaceRoot: string
  ignoredFolderNames: string[]
  /** Extensions to hide in the explorer (no dot, lowercased). */
  ignoredFileExtensions: string[]
  /** Stored LMDB path (absolute or relative to workspace root). */
  lmdbPath: string
  /**
   * @deprecated Prefer {@link lmdbTimelineKeyRules}; kept for older configs.
   */
  lmdbTimelineKeyRegex: string
  lmdbTimelineKeyRules: LmdbTimelineKeyRule[]
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
  /** Single JSON config file path relative to workspace (empty if unset). */
  workspaceConfigFileRelativePath: string
  /**
   * Dotted JSON paths hidden in the workspace config form preview only (e.g. secrets.apiKey).
   */
  configFormExcludedPaths: string[]
}

export interface LmdbPreviewResult {
  keys: string[]
  error?: string
}

/** One row in the LMDB timeline key-regex list (Settings + timeline viewer). */
export interface LmdbTimelineRuleRow {
  id: string
  lmdbPath: string
  keyRegex: string
  /** True when this rule's LMDB path pattern matches the opened database file. */
  matchesThisFile: boolean
  /** True when this rule's regex is the one applied for the timeline (first match wins). */
  appliesToTimeline: boolean
}

export interface LmdbTimelineBoundsResult {
  minMs: number
  maxMs: number
  entryCount: number
  totalDbEntries: number
  error?: string
  /** Regex used to parse time from keys for this file, if any (else heuristics only). */
  activeKeyRegex: string | null
  /** All configured LMDB files → key regex rules, with flags for this open file. */
  timelineRuleRows: LmdbTimelineRuleRow[]
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
  /** Replace the full list of LMDB path → key-regex rules (timeline). */
  setLmdbTimelineKeyRules: (rules: LmdbTimelineKeyRule[]) => Promise<void>
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
  /** Min/max time range for LMDB timeline preview (time inferred from keys/values). */
  lmdbTimelineBounds: (
    rootPath: string,
    relativePath: string
  ) => Promise<LmdbTimelineBoundsResult>
  /** Rows with decoded values between startMs and endMs (inclusive). */
  lmdbTimelineQuery: (
    rootPath: string,
    relativePath: string,
    startMs: number,
    endMs: number
  ) => Promise<LmdbTimelineQueryResult>
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
  setWorkspaceConfigFile: (relativePath: string | null) => Promise<void>
  subscribeWorkspaceConfigFileChanged: (handler: () => void) => () => void
  setConfigFormExcludedPaths: (paths: string[]) => Promise<void>
  subscribeConfigFormExcludedPathsChanged: (handler: () => void) => () => void
  subscribeLmdbTimelineSettingsChanged: (handler: () => void) => () => void
}
