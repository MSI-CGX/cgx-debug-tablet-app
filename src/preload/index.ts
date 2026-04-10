import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppAPI } from './types'

const api: AppAPI = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('folder:open'),
  listFiles: (folderPath: string) => ipcRenderer.invoke('folder:listFiles', folderPath),
  readFileText: (folderPath: string, relativePath: string) =>
    ipcRenderer.invoke('file:readText', folderPath, relativePath)
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
