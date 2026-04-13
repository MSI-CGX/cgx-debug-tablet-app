import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppAPI, AppLocale, FileReadMode } from './types'

const api: AppAPI = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('folder:open'),
  listFolderContents: (rootPath: string, relativeDir?: string) =>
    ipcRenderer.invoke('folder:listContents', rootPath, relativeDir ?? ''),
  readFileText: (folderPath: string, relativePath: string) =>
    ipcRenderer.invoke('file:readText', folderPath, relativePath),
  readImagePreview: (rootPath: string, relativePath: string) =>
    ipcRenderer.invoke('file:readImagePreview', rootPath, relativePath),
  setFileReadMode: (
    rootPath: string,
    relativePath: string,
    mode: Exclude<FileReadMode, 'plain'> | 'default'
  ): Promise<void> =>
    ipcRenderer.invoke('file:setReadMode', rootPath, relativePath, mode),
  showFolderContextMenu: (
    rootPath: string,
    relativePath: string,
    screenX: number,
    screenY: number
  ): void => {
    ipcRenderer.send('folder:contextMenu', {
      rootPath,
      relativePath,
      x: screenX,
      y: screenY
    })
  },
  showFileContextMenu: (
    rootPath: string,
    relativePath: string,
    screenX: number,
    screenY: number
  ): void => {
    ipcRenderer.send('file:contextMenu', {
      rootPath,
      relativePath,
      x: screenX,
      y: screenY
    })
  },
  subscribeIgnoredFoldersChanged: (handler: () => void): (() => void) => {
    const channel = 'config:ignoredFoldersChanged'
    const fn = (): void => {
      handler()
    }
    ipcRenderer.on(channel, fn)
    return (): void => {
      ipcRenderer.removeListener(channel, fn)
    }
  },
  subscribeFileBindingsChanged: (handler: () => void): (() => void) => {
    const channel = 'config:fileBindingsChanged'
    const fn = (): void => {
      handler()
    }
    ipcRenderer.on(channel, fn)
    return (): void => {
      ipcRenderer.removeListener(channel, fn)
    }
  },
  getConfigSnapshot: () => ipcRenderer.invoke('config:getSnapshot'),
  removeIgnoredFolderName: (name: string) =>
    ipcRenderer.invoke('config:removeIgnoredFolderName', name),
  clearAllIgnoredFolderNames: () => ipcRenderer.invoke('config:clearAllIgnoredFolderNames'),
  setIgnoredFileExtensions: (extensions: string[]) =>
    ipcRenderer.invoke('config:setIgnoredFileExtensions', extensions),
  setLmdbPath: (p: string) => ipcRenderer.invoke('config:setLmdbPath', p),
  setExtensionPreviewMap: (map: Record<string, 'text' | 'image'>) =>
    ipcRenderer.invoke('config:setExtensionPreviewMap', map),
  resetExtensionDefaults: () => ipcRenderer.invoke('config:resetExtensionDefaults'),
  setLogHighlightRules: (payload) =>
    ipcRenderer.invoke('config:setLogHighlightRules', payload),
  resetLogHighlightRules: () => ipcRenderer.invoke('config:resetLogHighlightRules'),
  subscribeLogRulesChanged: (handler: () => void): (() => void) => {
    const channel = 'config:logRulesChanged'
    const fn = (): void => {
      handler()
    }
    ipcRenderer.on(channel, fn)
    return (): void => {
      ipcRenderer.removeListener(channel, fn)
    }
  },
  previewLmdb: (overridePath?: string) => ipcRenderer.invoke('lmdb:preview', overridePath),
  previewLmdbAt: (rootPath: string, relativePath: string) =>
    ipcRenderer.invoke('lmdb:previewAt', rootPath, relativePath),
  lmdbTimelineBounds: (rootPath: string, relativePath: string) =>
    ipcRenderer.invoke('lmdb:timelineBounds', rootPath, relativePath),
  lmdbTimelineQuery: (rootPath: string, relativePath: string, startMs: number, endMs: number) =>
    ipcRenderer.invoke('lmdb:timelineQuery', rootPath, relativePath, startMs, endMs),
  setLocale: (locale: AppLocale) => ipcRenderer.invoke('config:setLocale', locale),
  subscribeLocaleChanged: (handler: (locale: AppLocale) => void): (() => void) => {
    const channel = 'config:localeChanged'
    const fn = (_: unknown, locale: AppLocale): void => {
      handler(locale)
    }
    ipcRenderer.on(channel, fn)
    return (): void => {
      ipcRenderer.removeListener(channel, fn)
    }
  },
  openFavorite: (id: string) => ipcRenderer.invoke('favorites:open', id),
  removeFavorite: (id: string) => ipcRenderer.invoke('favorites:remove', id),
  showFavoriteContextMenu: (id: string, screenX: number, screenY: number): void => {
    ipcRenderer.send('favorite:contextMenu', {
      id,
      x: screenX,
      y: screenY
    })
  },
  subscribeFavoritesChanged: (handler: () => void): (() => void) => {
    const channel = 'config:favoritesChanged'
    const fn = (): void => {
      handler()
    }
    ipcRenderer.on(channel, fn)
    return (): void => {
      ipcRenderer.removeListener(channel, fn)
    }
  },
  openMapWindow: (): void => {
    ipcRenderer.send('map:openWindow')
  },
  readGeoJsonFileText: (relativePath: string) =>
    ipcRenderer.invoke('geoJson:readText', relativePath),
  removeGeoJsonMapLayer: (id: string) => ipcRenderer.invoke('geoJson:removeLayer', id),
  subscribeGeoJsonMapLayersChanged: (handler: () => void): (() => void) => {
    const channel = 'config:geoJsonMapLayersChanged'
    const fn = (): void => {
      handler()
    }
    ipcRenderer.on(channel, fn)
    return (): void => {
      ipcRenderer.removeListener(channel, fn)
    }
  },
  setWorkspaceConfigFile: (relativePath: string | null) =>
    ipcRenderer.invoke('config:setWorkspaceConfigFile', relativePath ?? ''),
  subscribeWorkspaceConfigFileChanged: (handler: () => void): (() => void) => {
    const channel = 'config:workspaceConfigFileChanged'
    const fn = (): void => {
      handler()
    }
    ipcRenderer.on(channel, fn)
    return (): void => {
      ipcRenderer.removeListener(channel, fn)
    }
  },
  setConfigFormExcludedPaths: (paths: string[]) =>
    ipcRenderer.invoke('config:setConfigFormExcludedPaths', paths),
  subscribeConfigFormExcludedPathsChanged: (handler: () => void): (() => void) => {
    const channel = 'config:configFormExcludedPathsChanged'
    const fn = (): void => {
      handler()
    }
    ipcRenderer.on(channel, fn)
    return (): void => {
      ipcRenderer.removeListener(channel, fn)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error (define in dts)
  window.electron = electronAPI
  // @ts-expect-error (define in dts)
  window.api = api
}
