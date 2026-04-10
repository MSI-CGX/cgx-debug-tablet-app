import Store from 'electron-store'

export type AppLocale = 'en' | 'fr'

/** How to interpret file bytes when previewing (electron-store/conf encryption). */
export type FileReadMode = 'plain' | 'electron-store-encrypted'

export interface AppStoreSchema {
  /** Folder base names hidden in the sidebar (any depth). */
  ignoredFolderNames: string[]
  /** Absolute path to an LMDB database directory for preview. */
  lmdbPath: string
  /** UI language for renderer and native menus that read from store. */
  locale: AppLocale
  /**
   * Per-file read mode: key = `${resolvedRoot}|${relativePath with /}`.
   * Absent keys default to plain text.
   */
  fileDbBindings: Record<string, FileReadMode>
}

export const appStore = new Store<AppStoreSchema>({
  name: 'config',
  defaults: {
    ignoredFolderNames: [],
    lmdbPath: '',
    locale: 'en',
    fileDbBindings: {}
  }
})

export function getIgnoredFolderNameSet(): Set<string> {
  return new Set(appStore.get('ignoredFolderNames', []))
}
