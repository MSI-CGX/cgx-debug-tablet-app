import Store from 'electron-store'

export type AppLocale = 'en' | 'fr'

export interface AppStoreSchema {
  /** Folder base names hidden in the sidebar (any depth). */
  ignoredFolderNames: string[]
  /** Absolute path to an LMDB database directory for preview. */
  lmdbPath: string
  /** UI language for renderer and native menus that read from store. */
  locale: AppLocale
}

export const appStore = new Store<AppStoreSchema>({
  name: 'config',
  defaults: {
    ignoredFolderNames: [],
    lmdbPath: '',
    locale: 'en'
  }
})

export function getIgnoredFolderNameSet(): Set<string> {
  return new Set(appStore.get('ignoredFolderNames', []))
}
