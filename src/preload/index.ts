import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppAPI, AppLocale, FileReadMode } from './types'

const api: AppAPI = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('folder:open'),
  listFolderContents: (rootPath: string, relativeDir?: string) =>
    ipcRenderer.invoke('folder:listContents', rootPath, relativeDir ?? ''),
  readFileText: (folderPath: string, relativePath: string) =>
    ipcRenderer.invoke('file:readText', folderPath, relativePath),
  setFileReadMode: (
    rootPath: string,
    relativePath: string,
    mode: FileReadMode | 'default'
  ): Promise<void> =>
    ipcRenderer.invoke('file:setReadMode', rootPath, relativePath, mode),
  showFolderContextMenu: (folderName: string, screenX: number, screenY: number): void => {
    ipcRenderer.send('folder:contextMenu', { folderName, x: screenX, y: screenY })
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
  setLmdbPath: (p: string) => ipcRenderer.invoke('config:setLmdbPath', p),
  previewLmdb: (overridePath?: string) => ipcRenderer.invoke('lmdb:preview', overridePath),
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
