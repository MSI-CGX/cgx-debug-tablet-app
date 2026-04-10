import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu
} from 'electron'
import { readFile, readdir, stat } from 'fs/promises'
import path from 'path'
import dotenv from 'dotenv'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  appStore,
  getIgnoredFolderNameSet,
  type AppLocale,
  type FileReadMode
} from './appStore'
import { sampleLmdbKeys } from './lmdbPreview'
import { decryptConfEncryptedBuffer } from './decryptConfFile'
import { fileBindingKey, getFileReadMode } from './fileBindings'

dotenv.config({ path: path.join(process.cwd(), '.env') })

const MAX_READ_BYTES = 5 * 1024 * 1024

const MAIN_I18N: Record<
  AppLocale,
  {
    ignoreFolder: string
    fileTooLarge: (maxBytes: number) => string
    fileReadAsPlain: string
    fileReadAsEncrypted: string
    fileDecryptNoKey: string
  }
> = {
  en: {
    ignoreFolder: 'Ignore folder',
    fileTooLarge: (maxBytes: number) =>
      `File is larger than ${maxBytes} bytes`,
    fileReadAsPlain: 'Read as plain text',
    fileReadAsEncrypted: 'Read as encrypted (electron-store)',
    fileDecryptNoKey: 'STORE_KEY is not set — cannot decrypt this file'
  },
  fr: {
    ignoreFolder: 'Ignorer le dossier',
    fileTooLarge: (maxBytes: number) =>
      `Le fichier dépasse ${maxBytes} octets`,
    fileReadAsPlain: 'Lire en texte brut',
    fileReadAsEncrypted: 'Lire comme chiffré (electron-store)',
    fileDecryptNoKey:
      'STORE_KEY n’est pas défini — impossible de déchiffrer ce fichier'
  }
}

function getStoreKeyFromEnv(): string | undefined {
  const k = process.env['STORE_KEY']?.trim()
  return k || undefined
}

function getAppLocale(): AppLocale {
  const raw = appStore.get('locale', 'en')
  return raw === 'fr' ? 'fr' : 'en'
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

function notifyFileBindingsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('config:fileBindingsChanged')
    }
  }
}

function applyFileReadMode(
  rootFolderPath: string,
  relativePath: string,
  mode: FileReadMode | 'plain' | 'default'
): void {
  const key = fileBindingKey(rootFolderPath, relativePath)
  const current = { ...appStore.get('fileDbBindings', {}) }
  if (mode === 'default' || mode === 'plain') {
    delete current[key]
  } else if (mode === 'electron-store-encrypted') {
    current[key] = 'electron-store-encrypted'
  }
  appStore.set('fileDbBindings', current)
  notifyFileBindingsChanged()
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
        readMode?: FileReadMode
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
          const bindings = appStore.get('fileDbBindings', {})
          const readMode = getFileReadMode(
            bindings,
            rootFolderPath,
            relativePath
          )
          out.push({
            name: entry.name,
            relativePath,
            kind: 'file',
            size: st.size,
            readMode
          })
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
      const locale = getAppLocale()
      const bindings = appStore.get('fileDbBindings', {})
      const mode = getFileReadMode(bindings, folderPath, relativePath)
      if (mode === 'electron-store-encrypted') {
        const storeKey = getStoreKeyFromEnv()
        if (!storeKey) {
          throw new Error(MAIN_I18N[locale].fileDecryptNoKey)
        }
        const buf = await readFile(safeFull)
        return decryptConfEncryptedBuffer(buf, storeKey)
      }
      return readFile(safeFull, 'utf-8')
    }
  )

  ipcMain.handle(
    'file:setReadMode',
    (
      _,
      rootFolderPath: string,
      relativePath: string,
      mode: FileReadMode | 'plain' | 'default'
    ) => {
      if (typeof rootFolderPath !== 'string' || typeof relativePath !== 'string') {
        return
      }
      applyFileReadMode(rootFolderPath, relativePath, mode)
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
      hasStoreKey: Boolean(getStoreKeyFromEnv())
    }
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
    'file:contextMenu',
    (
      event,
      payload: {
        rootPath: string
        relativePath: string
        x: number
        y: number
      }
    ) => {
      if (
        !payload ||
        typeof payload.rootPath !== 'string' ||
        typeof payload.relativePath !== 'string'
      ) {
        return
      }
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return

      const locale = getAppLocale()
      const hasKey = Boolean(getStoreKeyFromEnv())
      const menu = Menu.buildFromTemplate([
        {
          label: MAIN_I18N[locale].fileReadAsPlain,
          click: (): void => {
            applyFileReadMode(payload.rootPath, payload.relativePath, 'plain')
          }
        },
        {
          label: MAIN_I18N[locale].fileReadAsEncrypted,
          enabled: hasKey,
          click: (): void => {
            if (!hasKey) return
            applyFileReadMode(
              payload.rootPath,
              payload.relativePath,
              'electron-store-encrypted'
            )
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
