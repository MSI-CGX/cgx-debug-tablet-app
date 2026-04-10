export type EntryKind = 'file' | 'directory'

/** How the main process decodes file bytes for preview. */
export type FileReadMode = 'plain' | 'electron-store-encrypted'

export interface FolderEntry {
  name: string
  /** Path relative to the opened root folder (native separators). */
  relativePath: string
  kind: EntryKind
  /** Only set for files. */
  size?: number
  /** Only set for files; plain if omitted. */
  readMode?: FileReadMode
}

export type AppLocale = 'en' | 'fr'

export interface ConfigSnapshot {
  storePath: string
  ignoredFolderNames: string[]
  lmdbPath: string
  locale: AppLocale
  /** True when STORE_KEY is set in the environment (e.g. `.env`). */
  hasStoreKey: boolean
}

export interface LmdbPreviewResult {
  keys: string[]
  error?: string
}

export interface AppAPI {
  openFolder: () => Promise<string | null>
  listFolderContents: (rootPath: string, relativeDir?: string) => Promise<FolderEntry[]>
  readFileText: (rootPath: string, relativePath: string) => Promise<string>
  setFileReadMode: (
    rootPath: string,
    relativePath: string,
    mode: FileReadMode | 'default'
  ) => Promise<void>
  showFolderContextMenu: (folderName: string, screenX: number, screenY: number) => void
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
  setLmdbPath: (path: string) => Promise<void>
  previewLmdb: (overridePath?: string) => Promise<LmdbPreviewResult>
  setLocale: (locale: AppLocale) => Promise<void>
  subscribeLocaleChanged: (handler: (locale: AppLocale) => void) => () => void
}
