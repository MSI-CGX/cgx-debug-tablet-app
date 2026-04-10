import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { readFile, readdir, stat } from 'fs/promises'
import path from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

const MAX_READ_BYTES = 5 * 1024 * 1024

function assertPathInsideRoot(root: string, relativePath: string): string {
  const rootResolved = path.resolve(root)
  const full = path.resolve(rootResolved, relativePath)
  const rel = path.relative(rootResolved, full)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid path')
  }
  return full
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('folder:open', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle('folder:listFiles', async (_, folderPath: string) => {
    const root = path.resolve(folderPath)
    const entries = await readdir(root, { withFileTypes: true })
    const files: { name: string; relativePath: string; size: number }[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const relativePath = entry.name
      const full = path.join(root, relativePath)
      const st = await stat(full)
      files.push({ name: entry.name, relativePath, size: st.size })
    }
    files.sort((a, b) => a.name.localeCompare(b.name))
    return files
  })

  ipcMain.handle(
    'file:readText',
    async (_, folderPath: string, relativePath: string) => {
      const safeFull = assertPathInsideRoot(folderPath, relativePath)
      const st = await stat(safeFull)
      if (st.size > MAX_READ_BYTES) {
        throw new Error(`File is larger than ${MAX_READ_BYTES} bytes`)
      }
      return readFile(safeFull, 'utf-8')
    }
  )

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
