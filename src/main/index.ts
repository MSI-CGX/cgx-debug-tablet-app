import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu
} from 'electron'
import { readFile, readdir, stat } from 'fs/promises'
import { randomUUID } from 'crypto'
import path from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { appStore, getIgnoredFolderNameSet, type AppLocale } from './appStore'
import { sampleLmdbKeys } from './lmdbPreview'
import {
  DEFAULT_LOG_COLOR_RULES,
  type LogColorRule
} from '../shared/logRules'

const MAX_READ_BYTES = 5 * 1024 * 1024

const MAIN_I18N: Record<
  AppLocale,
  { ignoreFolder: string; fileTooLarge: (maxBytes: number) => string }
> = {
  en: {
    ignoreFolder: 'Ignore folder',
    fileTooLarge: (maxBytes: number) =>
      `File is larger than ${maxBytes} bytes`
  },
  fr: {
    ignoreFolder: 'Ignorer le dossier',
    fileTooLarge: (maxBytes: number) =>
      `Le fichier dépasse ${maxBytes} octets`
  }
}

function getAppLocale(): AppLocale {
  const raw = appStore.get('locale', 'en')
  return raw === 'fr' ? 'fr' : 'en'
}

function sanitizeLogColorRules(input: unknown): LogColorRule[] {
  if (!Array.isArray(input)) {
    return [...DEFAULT_LOG_COLOR_RULES]
  }
  const out: LogColorRule[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id =
      typeof r.id === 'string' && r.id.trim()
        ? r.id.trim()
        : randomUUID()
    const label = typeof r.label === 'string' ? r.label : ''
    const pattern = typeof r.pattern === 'string' ? r.pattern : ''
    const color =
      typeof r.color === 'string' && r.color.trim() ? r.color.trim() : '#e8eaed'
    if (!pattern.trim()) continue
    out.push({ id, label, pattern, color })
  }
  return out.length > 0 ? out : [...DEFAULT_LOG_COLOR_RULES]
}

function assertPathInsideRoot(root: string, relativePath: string): string {
  const rootResolved = path.resolve(root)
  const full = path.resolve(rootResolved, relativePath)
  const rel = path.relative(rootResolved, full)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid path')
  }
  return full
}

function notifyConfigChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('config:ignoredFoldersChanged')
    }
  }
}

function notifyLocaleChanged(locale: AppLocale): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('config:localeChanged', locale)
    }
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    show: false,
    resizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize()
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

  ipcMain.handle(
    'folder:listContents',
    async (_, rootFolderPath: string, relativeDir: string) => {
      const ignored = getIgnoredFolderNameSet()
      const base = assertPathInsideRoot(rootFolderPath, relativeDir || '')
      const entries = await readdir(base, { withFileTypes: true })
      const out: {
        name: string
        relativePath: string
        kind: 'file' | 'directory'
        size?: number
      }[] = []

      for (const entry of entries) {
        if (entry.isDirectory() && ignored.has(entry.name)) {
          continue
        }
        const relativePath = relativeDir
          ? path.join(relativeDir, entry.name)
          : entry.name
        if (entry.isDirectory()) {
          out.push({ name: entry.name, relativePath, kind: 'directory' })
        } else if (entry.isFile()) {
          const full = path.join(base, entry.name)
          const st = await stat(full)
          out.push({ name: entry.name, relativePath, kind: 'file', size: st.size })
        }
      }

      out.sort((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === 'directory' ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })
      return out
    }
  )

  ipcMain.handle(
    'file:readText',
    async (_, folderPath: string, relativePath: string) => {
      const safeFull = assertPathInsideRoot(folderPath, relativePath)
      const st = await stat(safeFull)
      if (st.size > MAX_READ_BYTES) {
        const locale = getAppLocale()
        throw new Error(MAIN_I18N[locale].fileTooLarge(MAX_READ_BYTES))
      }
      return readFile(safeFull, 'utf-8')
    }
  )

  ipcMain.handle('config:getSnapshot', () => {
    const envLmdb = process.env['LMDB_PATH']?.trim() ?? ''
    const storedLmdb = appStore.get('lmdbPath', '').trim()
    return {
      storePath: appStore.path,
      ignoredFolderNames: [...appStore.get('ignoredFolderNames', [])],
      lmdbPath: storedLmdb || envLmdb,
      locale: getAppLocale(),
      logColorRules: [...appStore.get('logColorRules', DEFAULT_LOG_COLOR_RULES)]
    }
  })

  ipcMain.handle('config:setLogColorRules', (_, raw: unknown) => {
    const next = sanitizeLogColorRules(raw)
    appStore.set('logColorRules', next)
  })

  ipcMain.handle('config:setLocale', (_, next: string) => {
    const locale: AppLocale = next === 'fr' ? 'fr' : 'en'
    appStore.set('locale', locale)
    notifyLocaleChanged(locale)
  })

  ipcMain.handle('config:setLmdbPath', (_, nextPath: string) => {
    appStore.set('lmdbPath', typeof nextPath === 'string' ? nextPath.trim() : '')
  })

  ipcMain.handle('config:removeIgnoredFolderName', (_, name: string) => {
    if (typeof name !== 'string' || !name) return
    const list = appStore.get('ignoredFolderNames', []).filter((n) => n !== name)
    appStore.set('ignoredFolderNames', list)
    notifyConfigChanged()
  })

  ipcMain.handle('config:clearAllIgnoredFolderNames', () => {
    appStore.set('ignoredFolderNames', [])
    notifyConfigChanged()
  })

  ipcMain.handle('lmdb:preview', async (_, overridePath?: string) => {
    const fromStore = appStore.get('lmdbPath', '').trim()
    const fromEnv = process.env['LMDB_PATH']?.trim() ?? ''
    const dbPath =
      typeof overridePath === 'string' && overridePath.trim()
        ? overridePath.trim()
        : fromStore || fromEnv
    return sampleLmdbKeys(dbPath)
  })

  ipcMain.on(
    'folder:contextMenu',
    (event, payload: { folderName: string; x: number; y: number }) => {
      if (
        !payload ||
        typeof payload.folderName !== 'string' ||
        !payload.folderName.trim()
      ) {
        return
      }
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return

      const locale = getAppLocale()
      const menu = Menu.buildFromTemplate([
        {
          label: MAIN_I18N[locale].ignoreFolder,
          click: (): void => {
            const name = payload.folderName.trim()
            const current = appStore.get('ignoredFolderNames', [])
            if (!current.includes(name)) {
              appStore.set('ignoredFolderNames', [...current, name])
            }
            notifyConfigChanged()
          }
        }
      ])

      menu.popup({
        window: win,
        x: Math.round(payload.x),
        y: Math.round(payload.y)
      })
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
