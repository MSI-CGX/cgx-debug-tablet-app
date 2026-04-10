export type EntryKind = 'file' | 'directory'

export interface FolderEntry {
  name: string
  /** Path relative to the opened root folder (native separators). */
  relativePath: string
  kind: EntryKind
  /** Only set for files. */
  size?: number
}

export type AppLocale = 'en' | 'fr'

export interface ConfigSnapshot {
  storePath: string
  ignoredFolderNames: string[]
  lmdbPath: string
  locale: AppLocale
}

export interface LmdbPreviewResult {
  keys: string[]
  error?: string
}

export interface AppAPI {
  openFolder: () => Promise<string | null>
  listFolderContents: (rootPath: string, relativeDir?: string) => Promise<FolderEntry[]>
  readFileText: (rootPath: string, relativePath: string) => Promise<string>
  showFolderContextMenu: (folderName: string, screenX: number, screenY: number) => void
  subscribeIgnoredFoldersChanged: (handler: () => void) => () => void
  getConfigSnapshot: () => Promise<ConfigSnapshot>
  removeIgnoredFolderName: (name: string) => Promise<void>
  clearAllIgnoredFolderNames: () => Promise<void>
  setLmdbPath: (path: string) => Promise<void>
  previewLmdb: (overridePath?: string) => Promise<LmdbPreviewResult>
  setLocale: (locale: AppLocale) => Promise<void>
  subscribeLocaleChanged: (handler: (locale: AppLocale) => void) => () => void
}
