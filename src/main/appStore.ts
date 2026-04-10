import Store from 'electron-store'
import {
  DEFAULT_LOG_COLOR_RULES,
  type LogColorRule
} from '../shared/logRules'

export type AppLocale = 'en' | 'fr'

export interface AppStoreSchema {
  /** Folder base names hidden in the sidebar (any depth). */
  ignoredFolderNames: string[]
  /** Absolute path to an LMDB database directory for preview. */
  lmdbPath: string
  /** UI language for renderer and native menus that read from store. */
  locale: AppLocale
  /** Regex-based line colors for log file preview (order matters: first match wins). */
  logColorRules: LogColorRule[]
}

export const appStore = new Store<AppStoreSchema>({
  name: 'config',
  defaults: {
    ignoredFolderNames: [],
    lmdbPath: '',
    locale: 'en',
    logColorRules: DEFAULT_LOG_COLOR_RULES
  }
})

export function getIgnoredFolderNameSet(): Set<string> {
  return new Set(appStore.get('ignoredFolderNames', []))
}
