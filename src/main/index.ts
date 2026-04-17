import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  type MenuItemConstructorOptions
} from 'electron'
import { existsSync } from 'fs'
import { readFile, readdir, stat } from 'fs/promises'
import path from 'path'
import dotenv from 'dotenv'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { randomUUID } from 'node:crypto'
import {
  appStore,
  DEFAULT_LOG_HIGHLIGHT_RULES,
  getDefaultExtensionPreviewMap,
  getIgnoredFileExtensionSet,
  getIgnoredFolderNameSet,
  type AppLocale,
  type ExtensionPreviewKind,
  type FavoriteEntry,
  type FileReadMode,
  type GeoJsonMapLayerEntry,
  type LogHighlightRule,
  type LmdbTimelineKeyRule
} from './appStore'
import { resolveFavoriteFromWorkspaceRel, type FavoriteOpenResult } from './favoriteNavigation'
import { getLmdbTimelineBounds, queryLmdbTimelineRange } from './lmdbTimeline'
import { getLmdbRefusalReason, type LmdbRefusalReason } from './lmdbProbe'
import { sampleLmdbKeys } from './lmdbPreview'
import { decryptConfEncryptedBuffer } from './decryptConfFile'
import { fileBindingKey, resolvePreviewReadMode } from './fileBindings'
import {
  migrateFavorites,
  normalizeFavoritesArray,
  runStoreMigrations
} from './migrateStore'
import {
  normalizeStoredRel,
  resolveUnderWorkspace,
  toWorkspaceRelative
} from './workspacePaths'
import { normalizeMapColorHex } from '../common/geoMapColors'
import {
  DEFAULT_GEO_MAP_CONTROL_POSITION,
  normalizeGeoMapControlPosition
} from '../common/geoMapControlPosition'
import { DEFAULT_GEO_MAP_ICON, normalizeGeoMapIconId } from '../common/geoMapIcons'
import { normalizeExcludedPathList } from '../common/configExcludedPaths'
import { normalizeAppLocale } from '../common/appLocale'

/**
 * Load `.env` from several locations so STORE_KEY works after `electron-builder`
 * packaging (project `.env` is not shipped; cwd is often not the app folder).
 * Packaged: try next to the executable, then `resources/`, then cwd and dev paths.
 */
function loadEnvFiles(): void {
  const paths: string[] = []
  try {
    if (app.isPackaged) {
      paths.push(path.join(path.dirname(process.execPath), '.env'))
      if (process.resourcesPath) {
        paths.push(path.join(process.resourcesPath, '.env'))
      }
    }
  } catch {
    /* app may not be fully initialised in edge cases */
  }
  paths.push(path.join(process.cwd(), '.env'))
  paths.push(path.resolve(__dirname, '../../.env'))

  const seen = new Set<string>()
  for (const p of paths) {
    const norm = path.normalize(path.resolve(p))
    if (seen.has(norm)) continue
    seen.add(norm)
    dotenv.config({ path: norm, override: false })
  }
}

loadEnvFiles()

runStoreMigrations(appStore)

const MAX_READ_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_GEOJSON_READ_BYTES = 25 * 1024 * 1024

const MAIN_I18N: Record<
  AppLocale,
  {
    ignoreFolder: string
    fileTooLarge: (maxBytes: number) => string
    fileReadAsEncrypted: string
    fileDecryptNoKey: string
    entryReadAsLmdb: string
    folderBrowseNormal: string
    fileReadWrongModeLmdb: string
    filePreviewAutomatic: string
    filePreviewAsText: string
    filePreviewAsImage: string
    fileReadWrongModeImage: string
    favoriteAddTo: string
    favoriteRemoveFrom: string
    geoMapAddToMap: string
    geoMapRemoveFromMap: string
    workspaceConfigSet: string
    workspaceConfigClear: string
    lmdbNotDatabaseJson: string
    lmdbNotValidLmdbFile: string
  }
> = {
  en: {
    ignoreFolder: 'Ignore folder',
    fileTooLarge: (maxBytes: number) =>
      `File is larger than ${maxBytes} bytes`,
    fileReadAsEncrypted: 'Read as encrypted (electron-store)',
    fileDecryptNoKey: 'STORE_KEY is not set — cannot decrypt this file',
    entryReadAsLmdb: 'Read as LMDB database',
    folderBrowseNormal: 'Browse as normal folder',
    fileReadWrongModeLmdb: 'This entry is set to LMDB preview — use explorer selection',
    filePreviewAutomatic: 'Use automatic preview (Settings → extensions)',
    filePreviewAsText: 'Preview as UTF-8 text',
    filePreviewAsImage: 'Preview as image',
    fileReadWrongModeImage: 'This file is opened as image — use explorer selection',
    favoriteAddTo: 'Add to favorites',
    favoriteRemoveFrom: 'Remove from favorites',
    geoMapAddToMap: 'Add to map',
    geoMapRemoveFromMap: 'Remove from map',
    workspaceConfigSet: 'Set as workspace config file',
    workspaceConfigClear: 'Unset workspace config file',
    lmdbNotDatabaseJson:
      'This file looks like plain JSON/text (e.g. GeoJSON), not an LMDB database. Use the context menu: automatic preview or UTF-8 text.',
    lmdbNotValidLmdbFile:
      'This file does not look like a valid LMDB data file (no LMDB metadata). Use automatic preview or text, or pick a real LMDB path.'
  },
  fr: {
    ignoreFolder: 'Ignorer le dossier',
    fileTooLarge: (maxBytes: number) =>
      `Le fichier dépasse ${maxBytes} octets`,
    fileReadAsEncrypted: 'Lire comme chiffré (electron-store)',
    fileDecryptNoKey:
      'STORE_KEY n’est pas défini — impossible de déchiffrer ce fichier',
    entryReadAsLmdb: 'Lire comme base LMDB',
    folderBrowseNormal: 'Parcourir comme dossier normal',
    fileReadWrongModeLmdb:
      'Cette entrée est en aperçu LMDB — utilisez la sélection dans l’explorateur',
    filePreviewAutomatic: 'Aperçu automatique (Paramètres → extensions)',
    filePreviewAsText: 'Aperçu en texte UTF-8',
    filePreviewAsImage: 'Aperçu en image',
    fileReadWrongModeImage:
      'Ce fichier est ouvert en image — utilisez la sélection dans l’explorateur',
    favoriteAddTo: 'Ajouter aux favoris',
    favoriteRemoveFrom: 'Retirer des favoris',
    geoMapAddToMap: 'Ajouter à la carte',
    geoMapRemoveFromMap: 'Retirer de la carte',
    workspaceConfigSet: 'Définir comme fichier de configuration du workspace',
    workspaceConfigClear: 'Retirer le fichier de configuration du workspace',
    lmdbNotDatabaseJson:
      'Ce fichier ressemble à du JSON/texte (ex. GeoJSON), pas à une base LMDB. Menu contextuel : aperçu automatique ou texte UTF-8.',
    lmdbNotValidLmdbFile:
      'Ce fichier ne ressemble pas à un fichier LMDB valide (métadonnées LMDB absentes). Utilisez l’aperçu automatique ou le texte, ou un vrai chemin LMDB.'
  },
  de: {
    ignoreFolder: 'Ordner ignorieren',
    fileTooLarge: (maxBytes: number) => `Datei ist größer als ${maxBytes} Bytes`,
    fileReadAsEncrypted: 'Verschlüsselt lesen (electron-store)',
    fileDecryptNoKey: 'STORE_KEY ist nicht gesetzt — Entschlüsselung nicht möglich',
    entryReadAsLmdb: 'Als LMDB-Datenbank lesen',
    folderBrowseNormal: 'Als normalen Ordner durchsuchen',
    fileReadWrongModeLmdb:
      'Dieser Eintrag ist auf LMDB-Vorschau gesetzt — Auswahl im Explorer verwenden',
    filePreviewAutomatic: 'Automatische Vorschau (Einstellungen → Erweiterungen)',
    filePreviewAsText: 'Als UTF-8-Text anzeigen',
    filePreviewAsImage: 'Als Bild anzeigen',
    fileReadWrongModeImage:
      'Diese Datei ist als Bild geöffnet — Auswahl im Explorer verwenden',
    favoriteAddTo: 'Zu Favoriten hinzufügen',
    favoriteRemoveFrom: 'Aus Favoriten entfernen',
    geoMapAddToMap: 'Zur Karte hinzufügen',
    geoMapRemoveFromMap: 'Von der Karte entfernen',
    workspaceConfigSet: 'Als Workspace-Konfigurationsdatei festlegen',
    workspaceConfigClear: 'Workspace-Konfiguration aufheben',
    lmdbNotDatabaseJson:
      'Diese Datei wirkt wie reines JSON/Text (z. B. GeoJSON), nicht wie eine LMDB-Datenbank. Kontextmenü: automatische Vorschau oder UTF-8-Text.',
    lmdbNotValidLmdbFile:
      'Diese Datei wirkt nicht wie eine gültige LMDB-Datei (keine LMDB-Metadaten). Automatische Vorschau oder Text verwenden, oder einen echten LMDB-Pfad wählen.'
  },
  pt: {
    ignoreFolder: 'Ignorar pasta',
    fileTooLarge: (maxBytes: number) => `O ficheiro é maior do que ${maxBytes} bytes`,
    fileReadAsEncrypted: 'Ler como encriptado (electron-store)',
    fileDecryptNoKey: 'STORE_KEY não está definida — não é possível desencriptar',
    entryReadAsLmdb: 'Ler como base de dados LMDB',
    folderBrowseNormal: 'Explorar como pasta normal',
    fileReadWrongModeLmdb:
      'Esta entrada está em pré-visualização LMDB — use a seleção no explorador',
    filePreviewAutomatic: 'Pré-visualização automática (Definições → extensões)',
    filePreviewAsText: 'Pré-visualizar como texto UTF-8',
    filePreviewAsImage: 'Pré-visualizar como imagem',
    fileReadWrongModeImage:
      'Este ficheiro está aberto como imagem — use a seleção no explorador',
    favoriteAddTo: 'Adicionar aos favoritos',
    favoriteRemoveFrom: 'Remover dos favoritos',
    geoMapAddToMap: 'Adicionar ao mapa',
    geoMapRemoveFromMap: 'Remover do mapa',
    workspaceConfigSet: 'Definir como ficheiro de configuração do workspace',
    workspaceConfigClear: 'Limpar ficheiro de configuração do workspace',
    lmdbNotDatabaseJson:
      'Este ficheiro parece JSON/texto simples (ex. GeoJSON), não uma base LMDB. Menu de contexto: pré-visualização automática ou texto UTF-8.',
    lmdbNotValidLmdbFile:
      'Este ficheiro não parece um ficheiro LMDB válido (sem metadados LMDB). Use pré-visualização automática ou texto, ou um caminho LMDB real.'
  },
  es: {
    ignoreFolder: 'Ignorar carpeta',
    fileTooLarge: (maxBytes: number) => `El archivo supera los ${maxBytes} bytes`,
    fileReadAsEncrypted: 'Leer como cifrado (electron-store)',
    fileDecryptNoKey: 'STORE_KEY no está definida — no se puede descifrar',
    entryReadAsLmdb: 'Leer como base de datos LMDB',
    folderBrowseNormal: 'Explorar como carpeta normal',
    fileReadWrongModeLmdb:
      'Esta entrada está en vista previa LMDB — use la selección en el explorador',
    filePreviewAutomatic: 'Vista previa automática (Ajustes → extensiones)',
    filePreviewAsText: 'Vista previa como texto UTF-8',
    filePreviewAsImage: 'Vista previa como imagen',
    fileReadWrongModeImage:
      'Este archivo está abierto como imagen — use la selección en el explorador',
    favoriteAddTo: 'Añadir a favoritos',
    favoriteRemoveFrom: 'Quitar de favoritos',
    geoMapAddToMap: 'Añadir al mapa',
    geoMapRemoveFromMap: 'Quitar del mapa',
    workspaceConfigSet: 'Definir como archivo de configuración del workspace',
    workspaceConfigClear: 'Quitar archivo de configuración del workspace',
    lmdbNotDatabaseJson:
      'Este archivo parece JSON/texto (p. ej. GeoJSON), no una base LMDB. Menú contextual: vista previa automática o texto UTF-8.',
    lmdbNotValidLmdbFile:
      'Este archivo no parece un archivo LMDB válido (sin metadatos LMDB). Use vista previa automática o texto, o una ruta LMDB real.'
  }
}

function lmdbRefusalMessage(
  locale: AppLocale,
  reason: LmdbRefusalReason
): string {
  return reason === 'looks_like_json_text'
    ? MAIN_I18N[locale].lmdbNotDatabaseJson
    : MAIN_I18N[locale].lmdbNotValidLmdbFile
}

function mimeForImagePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.avif': 'image/avif'
  }
  return map[ext] ?? 'application/octet-stream'
}

function getStoreKeyFromEnv(): string | undefined {
  const k = process.env['STORE_KEY']?.trim()
  return k || undefined
}

function getAppLocale(): AppLocale {
  return normalizeAppLocale(appStore.get('locale', 'en'))
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

function pathsEqualResolved(a: string, b: string): boolean {
  return path.normalize(path.resolve(a)) === path.normalize(path.resolve(b))
}

/** True when the setting is a single file/folder name (no directory), e.g. `vehicles_paths_db.lmdb`. */
function isBasenameOnlyLmdbSetting(stored: string): boolean {
  const t = stored.trim()
  if (!t) return false
  return !/[\\/]/.test(t)
}

/**
 * Opened LMDB absolute path matches the configured {@link AppStoreSchema.lmdbPath}:
 * either full path equality, or (when the setting has no `/` or `\\`) same base file name anywhere under the workspace.
 */
function lmdbOpenMatchesConfigured(fullOpen: string, storedLmdb: string): boolean {
  const stored = storedLmdb.trim()
  if (!stored) return false
  if (isBasenameOnlyLmdbSetting(stored)) {
    const want = path.basename(stored)
    const got = path.basename(fullOpen)
    return got.localeCompare(want, undefined, { sensitivity: 'base' }) === 0
  }
  const fullSettings = path.resolve(resolveStoredLmdbPath(stored))
  return pathsEqualResolved(fullOpen, fullSettings)
}

/** Synthetic id for the deprecated `lmdbPath` + `lmdbTimelineKeyRegex` pair in rule listings. */
const LEGACY_LMDB_TIMELINE_RULE_ID = '__legacy__'

type LmdbTimelineRuleRow = {
  id: string
  lmdbPath: string
  keyRegex: string
  /** True when this rule's `lmdbPath` pattern matches the opened database. */
  matchesThisFile: boolean
  /** True when this rule supplies the regex used for the timeline (first match wins). */
  appliesToTimeline: boolean
}

/**
 * Rows for Settings-style list: every configured rule plus optional legacy pair, with match flags.
 */
function buildLmdbTimelineRuleRowsForOpenFile(
  fullOpen: string,
  activeRuleId: string | typeof LEGACY_LMDB_TIMELINE_RULE_ID | null
): LmdbTimelineRuleRow[] {
  const out: LmdbTimelineRuleRow[] = []
  const rules = appStore.get('lmdbTimelineKeyRules', []) as LmdbTimelineKeyRule[]
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      if (!rule || typeof rule.id !== 'string') continue
      const p = (rule.lmdbPath ?? '').trim()
      const rx = (rule.keyRegex ?? '').trim()
      const matches = p !== '' && rx !== '' && lmdbOpenMatchesConfigured(fullOpen, p)
      out.push({
        id: rule.id,
        lmdbPath: p || '—',
        keyRegex: rx || '—',
        matchesThisFile: matches,
        appliesToTimeline: activeRuleId !== null && rule.id === activeRuleId
      })
    }
  }
  const legacyRegex = appStore.get('lmdbTimelineKeyRegex', '').trim()
  const legacyPath = appStore.get('lmdbPath', '').trim()
  if (legacyRegex !== '' && legacyPath !== '') {
    const matches = lmdbOpenMatchesConfigured(fullOpen, legacyPath)
    out.push({
      id: LEGACY_LMDB_TIMELINE_RULE_ID,
      lmdbPath: legacyPath,
      keyRegex: legacyRegex,
      matchesThisFile: matches,
      appliesToTimeline: activeRuleId === LEGACY_LMDB_TIMELINE_RULE_ID
    })
  }
  return out
}

/**
 * First matching {@link LmdbTimelineKeyRule} for the opened LMDB path; else legacy single pair if present.
 */
function getTimelineKeyRegexForOpenPath(
  rootFolderPath: string,
  relativePath: string
): {
  regexStr?: string
  error?: string
  activeRuleId?: string | typeof LEGACY_LMDB_TIMELINE_RULE_ID | null
} {
  let fullOpen: string
  try {
    fullOpen = assertPathInsideRoot(rootFolderPath, relativePath)
  } catch {
    return {}
  }
  const rules = appStore.get('lmdbTimelineKeyRules', []) as LmdbTimelineKeyRule[]
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      const p = (rule?.lmdbPath ?? '').trim()
      const rx = (rule?.keyRegex ?? '').trim()
      if (!p || !rx) continue
      if (!lmdbOpenMatchesConfigured(fullOpen, p)) continue
      try {
        new RegExp(rx)
      } catch (e) {
        return {
          error: `Invalid LMDB key regex for "${p}": ${e instanceof Error ? e.message : String(e)}`
        }
      }
      return { regexStr: rx, activeRuleId: rule.id }
    }
  }
  const legacyRegex = appStore.get('lmdbTimelineKeyRegex', '').trim()
  const legacyPath = appStore.get('lmdbPath', '').trim()
  if (legacyRegex && legacyPath && lmdbOpenMatchesConfigured(fullOpen, legacyPath)) {
    try {
      new RegExp(legacyRegex)
    } catch (e) {
      return {
        error: `Invalid LMDB timestamp key regex: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    return { regexStr: legacyRegex, activeRuleId: LEGACY_LMDB_TIMELINE_RULE_ID }
  }
  return { activeRuleId: null }
}

function notifyLmdbTimelineSettingsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('config:lmdbTimelineSettingsChanged')
    }
  }
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

function notifyLogRulesChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('config:logRulesChanged')
    }
  }
}

function notifyFavoritesChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('config:favoritesChanged')
    }
  }
}

function notifyWorkspaceRootChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('config:workspaceRootChanged')
    }
  }
}

function normalizePathKey(p: string): string {
  return path.normalize(path.resolve(p))
}

function getWorkspaceRoot(): string {
  return appStore.get('workspaceRoot', '').trim()
}

function resolveStoredLmdbPath(stored: string): string {
  const t = stored.trim()
  if (!t) return ''
  if (path.isAbsolute(t)) {
    return path.normalize(t)
  }
  const wr = getWorkspaceRoot()
  if (!wr) {
    return path.normalize(t)
  }
  return resolveUnderWorkspace(wr, t)
}

function getFavoritesList(): FavoriteEntry[] {
  return normalizeFavoritesArray(getWorkspaceRoot(), appStore.get('favorites', []))
}

function findFavoriteIndex(absNormalized: string): number {
  const wr = getWorkspaceRoot()
  if (!wr) return -1
  const rel = toWorkspaceRelative(wr, absNormalized)
  if (rel === null) return -1
  const norm = normalizeStoredRel(rel)
  return getFavoritesList().findIndex(
    (f) => normalizeStoredRel(f.relativePath) === norm
  )
}

function applyFileReadMode(
  relativePath: string,
  mode: Exclude<FileReadMode, 'plain'> | 'default'
): void {
  const base = path.basename(relativePath)
  if (mode === 'lmdb' && /\.geojson$/i.test(base)) {
    return
  }
  const key = fileBindingKey(relativePath)
  const current = { ...appStore.get('fileDbBindings', {}) }
  if (mode === 'default') {
    delete current[key]
  } else {
    current[key] = mode
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

function notifyGeoJsonMapLayersChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('config:geoJsonMapLayersChanged')
    }
  }
}

function notifyWorkspaceConfigFileChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('config:workspaceConfigFileChanged')
    }
  }
}

function notifyConfigFormExcludedPathsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('config:configFormExcludedPathsChanged')
    }
  }
}

function getWorkspaceConfigFileRelativePath(): string {
  return appStore.get('workspaceConfigFileRelativePath', '').trim()
}

function getGeoJsonLayers(): GeoJsonMapLayerEntry[] {
  return [...appStore.get('geoJsonMapLayers', [])]
}

function findGeoJsonLayerIndexByRelativePath(normalizedRel: string): number {
  const n = normalizeStoredRel(normalizedRel)
  return getGeoJsonLayers().findIndex(
    (l) => normalizeStoredRel(l.relativePath) === n
  )
}

let mapWindow: BrowserWindow | null = null

/**
 * Same raster as electron-builder app icon (from resources/logo_splash.svg → build/icon.png).
 * PNG is required for reliable Windows / Linux window icons; SVG alone is often ignored.
 */
function getWindowIconPath(): string | undefined {
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, 'app-icon.png')
    return existsSync(packaged) ? packaged : undefined
  }
  const fromBuild = path.join(__dirname, '../../build/icon.png')
  if (existsSync(fromBuild)) return fromBuild
  const devSvg = path.join(__dirname, '../../resources/logo_splash.svg')
  return existsSync(devSvg) ? devSvg : undefined
}

function mapWindowDevUrl(): string {
  const raw = process.env['ELECTRON_RENDERER_URL']?.trim() ?? ''
  if (!raw) return ''
  const withoutIndex = raw.replace(/\/?index\.html\/?$/i, '').replace(/\/$/, '')
  return `${withoutIndex}/map.html`
}

function createMapWindow(): void {
  if (mapWindow && !mapWindow.isDestroyed()) {
    mapWindow.focus()
    return
  }
  const windowIcon = getWindowIconPath()
  mapWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 400,
    minHeight: 320,
    show: false,
    title: 'GeoJSON map',
    autoHideMenuBar: true,
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mapWindow.on('closed', () => {
    mapWindow = null
  })
  mapWindow.on('ready-to-show', () => {
    mapWindow?.show()
  })
  if (is.dev) {
    const url = mapWindowDevUrl()
    if (url) {
      void mapWindow.loadURL(url)
    } else {
      mapWindow.loadFile(path.join(__dirname, '../renderer/map.html'))
    }
  } else {
    mapWindow.loadFile(path.join(__dirname, '../renderer/map.html'))
  }
}

function createWindow(): void {
  const windowIcon = getWindowIconPath()
  const mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    show: false,
    // Required on Windows for the maximize control after restoring from maximized; resizable false disables it.
    resizable: true,
    maximizable: true,
    minWidth: 1024,
    minHeight: 768,
    autoHideMenuBar: true,
    ...(windowIcon ? { icon: windowIcon } : {}),
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
  electronApp.setAppUserModelId('com.cgx.debugtablet')

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
    const picked = result.filePaths[0]!
    appStore.set('workspaceRoot', normalizePathKey(picked))
    migrateFavorites(appStore)
    notifyWorkspaceRootChanged()
    return picked
  })

  ipcMain.handle(
    'folder:listContents',
    async (_, rootFolderPath: string, relativeDir: string) => {
      const ignored = getIgnoredFolderNameSet()
      const ignoredExts = getIgnoredFileExtensionSet()
      const base = assertPathInsideRoot(rootFolderPath, relativeDir || '')
      const entries = await readdir(base, { withFileTypes: true })
      const pathBindings = appStore.get('fileDbBindings', {})
      const extMap = appStore.get('extensionPreviewMap', {})
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
          const readMode = resolvePreviewReadMode(
            pathBindings,
            extMap,
            relativePath,
            'directory',
            entry.name
          )
          out.push({
            name: entry.name,
            relativePath,
            kind: 'directory',
            readMode: readMode === 'plain' ? undefined : readMode
          })
        } else if (entry.isFile()) {
          const fileExt = path.extname(entry.name).replace(/^\./, '').toLowerCase()
          if (fileExt && ignoredExts.has(fileExt)) {
            continue
          }
          const full = path.join(base, entry.name)
          const st = await stat(full)
          const readMode = resolvePreviewReadMode(
            pathBindings,
            extMap,
            relativePath,
            'file',
            entry.name
          )
          out.push({
            name: entry.name,
            relativePath,
            kind: 'file',
            size: st.size,
            readMode: readMode === 'plain' ? undefined : readMode
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
      const pathBindings = appStore.get('fileDbBindings', {})
      const extMap = appStore.get('extensionPreviewMap', {})
      const mode = resolvePreviewReadMode(
        pathBindings,
        extMap,
        relativePath,
        'file',
        path.basename(relativePath)
      )
      if (mode === 'lmdb') {
        throw new Error(MAIN_I18N[locale].fileReadWrongModeLmdb)
      }
      if (mode === 'image') {
        throw new Error(MAIN_I18N[locale].fileReadWrongModeImage)
      }
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
      mode: Exclude<FileReadMode, 'plain'> | 'default'
    ) => {
      if (typeof rootFolderPath !== 'string' || typeof relativePath !== 'string') {
        return
      }
      applyFileReadMode(relativePath, mode)
    }
  )

  ipcMain.handle(
    'file:readImagePreview',
    async (_, folderPath: string, relativePath: string) => {
      const safeFull = assertPathInsideRoot(folderPath, relativePath)
      const st = await stat(safeFull)
      if (st.size > MAX_IMAGE_BYTES) {
        const locale = getAppLocale()
        throw new Error(MAIN_I18N[locale].fileTooLarge(MAX_IMAGE_BYTES))
      }
      const pathBindings = appStore.get('fileDbBindings', {})
      const extMap = appStore.get('extensionPreviewMap', {})
      const mode = resolvePreviewReadMode(
        pathBindings,
        extMap,
        relativePath,
        'file',
        path.basename(relativePath)
      )
      if (mode !== 'image') {
        const locale = getAppLocale()
        throw new Error(MAIN_I18N[locale].fileReadWrongModeImage)
      }
      const buf = await readFile(safeFull)
      const mime = mimeForImagePath(safeFull)
      return {
        dataBase64: buf.toString('base64'),
        mime
      }
    }
  )

  ipcMain.handle('config:getSnapshot', () => {
    const storedLmdb = appStore.get('lmdbPath', '').trim()
    const storedExt = appStore.get('extensionPreviewMap', {})
    return {
      storePath: appStore.path,
      workspaceRoot: getWorkspaceRoot(),
      ignoredFolderNames: [...appStore.get('ignoredFolderNames', [])],
      ignoredFileExtensions: [...appStore.get('ignoredFileExtensions', [])],
      lmdbPath: storedLmdb,
      lmdbTimelineKeyRegex: appStore.get('lmdbTimelineKeyRegex', '').trim(),
      lmdbTimelineKeyRules: (() => {
        const raw = appStore.get('lmdbTimelineKeyRules', []) as LmdbTimelineKeyRule[]
        if (!Array.isArray(raw)) return []
        return raw.map((r) => ({
          id: typeof r.id === 'string' ? r.id : '',
          lmdbPath: typeof r.lmdbPath === 'string' ? r.lmdbPath : '',
          keyRegex: typeof r.keyRegex === 'string' ? r.keyRegex : ''
        }))
      })(),
      locale: getAppLocale(),
      hasStoreKey: Boolean(getStoreKeyFromEnv()),
      extensionPreviewMap: {
        ...getDefaultExtensionPreviewMap(),
        ...storedExt
      },
      logHighlightForAllTextFiles: Boolean(appStore.get('logHighlightForAllTextFiles', false)),
      logHighlightRules: (() => {
        const stored = appStore.get('logHighlightRules', DEFAULT_LOG_HIGHLIGHT_RULES)
        if (stored.length > 0) {
          return [...stored]
        }
        return [...DEFAULT_LOG_HIGHLIGHT_RULES]
      })(),
      favorites: getFavoritesList().map((f) => ({ ...f })),
      geoJsonMapLayers: getGeoJsonLayers().map((l) => ({ ...l })),
      geoJsonMapToolbarPosition: normalizeGeoMapControlPosition(
        appStore.get('geoJsonMapToolbarPosition', DEFAULT_GEO_MAP_CONTROL_POSITION)
      ),
      workspaceConfigFileRelativePath: getWorkspaceConfigFileRelativePath(),
      configFormExcludedPaths: [
        ...normalizeExcludedPathList(appStore.get('configFormExcludedPaths', []))
      ]
    }
  })

  ipcMain.handle('config:setWorkspaceConfigFile', (_, relativePath: unknown) => {
    if (relativePath === null || relativePath === '') {
      appStore.set('workspaceConfigFileRelativePath', '')
      notifyWorkspaceConfigFileChanged()
      return
    }
    if (typeof relativePath !== 'string' || !relativePath.trim()) return
    appStore.set('workspaceConfigFileRelativePath', normalizeStoredRel(relativePath))
    notifyWorkspaceConfigFileChanged()
  })

  ipcMain.handle('config:setConfigFormExcludedPaths', (_, next: unknown) => {
    if (!Array.isArray(next)) return
    const normalized = normalizeExcludedPathList(next)
    appStore.set('configFormExcludedPaths', normalized)
    notifyConfigFormExcludedPathsChanged()
  })

  ipcMain.on('map:openWindow', () => {
    createMapWindow()
  })

  ipcMain.handle(
    'geoJson:readText',
    async (_, relativePath: unknown) => {
      if (typeof relativePath !== 'string' || !relativePath.trim()) {
        return { ok: false as const, error: 'Invalid path' }
      }
      const wr = getWorkspaceRoot()
      if (!wr) {
        return { ok: false as const, error: 'No workspace folder' }
      }
      const rel = normalizeStoredRel(relativePath)
      const full = resolveUnderWorkspace(wr, rel)
      try {
        const st = await stat(full)
        if (!st.isFile()) {
          return { ok: false as const, error: 'Not a file' }
        }
        if (st.size > MAX_GEOJSON_READ_BYTES) {
          return { ok: false as const, error: 'GeoJSON file is too large' }
        }
        const text = await readFile(full, 'utf-8')
        return { ok: true as const, text }
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e)
        }
      }
    }
  )

  ipcMain.handle('geoJson:removeLayer', (_, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) return
    const next = getGeoJsonLayers().filter((l) => l.id !== id.trim())
    appStore.set('geoJsonMapLayers', next)
    notifyGeoJsonMapLayersChanged()
  })

  ipcMain.handle('geoJson:setLayerMapIcon', (_, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const p = payload as { id?: unknown; mapIcon?: unknown }
    if (typeof p.id !== 'string' || !p.id.trim()) return
    const layerId = p.id.trim()
    const normalized = normalizeGeoMapIconId(p.mapIcon)
    const list = getGeoJsonLayers()
    const idx = list.findIndex((l) => l.id === layerId)
    if (idx < 0) return
    const prev = list[idx]!
    if (prev.mapIcon === normalized) return
    const next = [...list]
    next[idx] = { ...prev, mapIcon: normalized }
    appStore.set('geoJsonMapLayers', next)
    notifyGeoJsonMapLayersChanged()
  })

  ipcMain.handle('geoJson:setLayerMapColor', (_, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const p = payload as { id?: unknown; mapColor?: unknown }
    if (typeof p.id !== 'string' || !p.id.trim()) return
    const layerId = p.id.trim()
    const list = getGeoJsonLayers()
    const idx = list.findIndex((l) => l.id === layerId)
    if (idx < 0) return
    const prev = list[idx]!
    if (p.mapColor === null || p.mapColor === '') {
      if (prev.mapColor === undefined) return
      const next = [...list]
      const { mapColor: _drop, ...rest } = prev
      next[idx] = rest as GeoJsonMapLayerEntry
      appStore.set('geoJsonMapLayers', next)
      notifyGeoJsonMapLayersChanged()
      return
    }
    if (typeof p.mapColor !== 'string') return
    const normalized = normalizeMapColorHex(p.mapColor)
    if (!normalized) return
    if (prev.mapColor === normalized) return
    const next = [...list]
    next[idx] = { ...prev, mapColor: normalized }
    appStore.set('geoJsonMapLayers', next)
    notifyGeoJsonMapLayersChanged()
  })

  ipcMain.handle('geoJson:setMapToolbarPosition', (_, position: unknown) => {
    const normalized = normalizeGeoMapControlPosition(position)
    const prev = normalizeGeoMapControlPosition(
      appStore.get('geoJsonMapToolbarPosition', DEFAULT_GEO_MAP_CONTROL_POSITION)
    )
    if (prev === normalized) return
    appStore.set('geoJsonMapToolbarPosition', normalized)
    notifyGeoJsonMapLayersChanged()
  })

  ipcMain.handle('config:setIgnoredFileExtensions', (_, next: unknown) => {
    if (!Array.isArray(next)) return
    const out: string[] = []
    for (const item of next) {
      const e = String(item)
        .replace(/^\./, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
      if (!e || out.includes(e)) continue
      out.push(e)
    }
    out.sort()
    appStore.set('ignoredFileExtensions', out)
    notifyConfigChanged()
  })

  ipcMain.handle('config:setLogHighlightRules', (_, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const p = payload as { rules?: unknown; forAllTextFiles?: unknown }
    const raw = p.rules
    if (!Array.isArray(raw)) return
    const rules: LogHighlightRule[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `rule-${rules.length}`
      const match = typeof o.match === 'string' ? o.match : ''
      const color = typeof o.color === 'string' ? o.color.trim() : '#e8eaed'
      if (!match) continue
      rules.push({ id, match, color })
    }
    appStore.set('logHighlightRules', rules)
    if (typeof p.forAllTextFiles === 'boolean') {
      appStore.set('logHighlightForAllTextFiles', p.forAllTextFiles)
    }
    notifyLogRulesChanged()
  })

  ipcMain.handle('config:resetLogHighlightRules', () => {
    appStore.set('logHighlightRules', [...DEFAULT_LOG_HIGHLIGHT_RULES])
    appStore.set('logHighlightForAllTextFiles', false)
    notifyLogRulesChanged()
  })

  ipcMain.handle('config:setExtensionPreviewMap', (_, next: unknown) => {
    if (!next || typeof next !== 'object') return
    const out: Record<string, ExtensionPreviewKind> = {}
    for (const [k, v] of Object.entries(next as Record<string, unknown>)) {
      const key = String(k)
        .replace(/^\./, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
      if (!key) continue
      if (v === 'image' || v === 'text') {
        out[key] = v
      }
    }
    appStore.set('extensionPreviewMap', out)
    notifyFileBindingsChanged()
  })

  ipcMain.handle('config:resetExtensionDefaults', () => {
    appStore.set('extensionPreviewMap', { ...getDefaultExtensionPreviewMap() })
    notifyFileBindingsChanged()
  })

  ipcMain.handle('favorites:open', async (_, id: unknown): Promise<FavoriteOpenResult> => {
    if (typeof id !== 'string' || !id.trim()) {
      return { ok: false, error: 'Invalid id' }
    }
    const fav = getFavoritesList().find((f) => f.id === id.trim())
    if (!fav) {
      return { ok: false, error: 'Favorite not found' }
    }
    const wr = getWorkspaceRoot()
    if (!wr) {
      return { ok: false, error: 'No workspace folder — open a folder first' }
    }
    return resolveFavoriteFromWorkspaceRel(wr, fav.relativePath)
  })

  ipcMain.handle('favorites:remove', (_, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) return
    const next = getFavoritesList().filter((f) => f.id !== id.trim())
    appStore.set('favorites', next)
    notifyFavoritesChanged()
  })

  ipcMain.handle('config:setLocale', (_, next: unknown) => {
    const locale = normalizeAppLocale(typeof next === 'string' ? next : '')
    appStore.set('locale', locale)
    notifyLocaleChanged(locale)
  })

  ipcMain.handle('config:setLmdbPath', (_, nextPath: string) => {
    const t = typeof nextPath === 'string' ? nextPath.trim() : ''
    const wr = getWorkspaceRoot()
    if (wr && t && path.isAbsolute(t)) {
      const rel = toWorkspaceRelative(wr, t)
      if (rel !== null) {
        appStore.set('lmdbPath', rel)
        notifyLmdbTimelineSettingsChanged()
        return
      }
    }
    if (wr && t && !path.isAbsolute(t)) {
      appStore.set('lmdbPath', normalizeStoredRel(t))
      notifyLmdbTimelineSettingsChanged()
      return
    }
    appStore.set('lmdbPath', t)
    notifyLmdbTimelineSettingsChanged()
  })

  ipcMain.handle('config:setLmdbTimelineKeyRules', (_, next: unknown) => {
    if (!Array.isArray(next)) return
    const out: LmdbTimelineKeyRule[] = []
    for (const item of next) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const rawId = typeof o.id === 'string' ? o.id.trim() : ''
      const lmdbPath = typeof o.lmdbPath === 'string' ? o.lmdbPath.trim() : ''
      const keyRegex = typeof o.keyRegex === 'string' ? o.keyRegex.trim() : ''
      if (!lmdbPath || !keyRegex) continue
      out.push({
        id: rawId || randomUUID(),
        lmdbPath,
        keyRegex
      })
    }
    appStore.set('lmdbTimelineKeyRules', out)
    notifyLmdbTimelineSettingsChanged()
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
    let dbPath = ''
    if (typeof overridePath === 'string' && overridePath.trim()) {
      // Same resolution as stored settings: relative paths use the workspace root, not process cwd.
      dbPath = resolveStoredLmdbPath(overridePath.trim())
    } else if (fromStore) {
      dbPath = resolveStoredLmdbPath(fromStore)
    } else {
      dbPath = fromEnv
    }
    const trimmed = dbPath.trim()
    if (trimmed) {
      const locale = getAppLocale()
      const refusal = await getLmdbRefusalReason(path.resolve(trimmed))
      if (refusal !== null) {
        return { keys: [] as string[], error: lmdbRefusalMessage(locale, refusal) }
      }
    }
    return sampleLmdbKeys(dbPath)
  })

  ipcMain.handle(
    'lmdb:previewAt',
    async (_, rootFolderPath: string, relativePath: string) => {
      if (typeof rootFolderPath !== 'string' || typeof relativePath !== 'string') {
        return { keys: [] as string[], error: 'Invalid path' }
      }
      const full = assertPathInsideRoot(rootFolderPath, relativePath)
      const locale = getAppLocale()
      const refusal = await getLmdbRefusalReason(full)
      if (refusal !== null) {
        return { keys: [] as string[], error: lmdbRefusalMessage(locale, refusal) }
      }
      return sampleLmdbKeys(full)
    }
  )

  ipcMain.handle(
    'lmdb:timelineBounds',
    async (_, rootFolderPath: string, relativePath: string) => {
      if (typeof rootFolderPath !== 'string' || typeof relativePath !== 'string') {
        return {
          minMs: 0,
          maxMs: 0,
          entryCount: 0,
          totalDbEntries: 0,
          error: 'Invalid path',
          activeKeyRegex: null,
          timelineRuleRows: []
        }
      }
      let full: string
      try {
        full = assertPathInsideRoot(rootFolderPath, relativePath)
      } catch {
        return {
          minMs: 0,
          maxMs: 0,
          entryCount: 0,
          totalDbEntries: 0,
          error: 'Invalid path',
          activeKeyRegex: null,
          timelineRuleRows: []
        }
      }
      const locale = getAppLocale()
      const refusal = await getLmdbRefusalReason(full)
      if (refusal !== null) {
        return {
          minMs: 0,
          maxMs: 0,
          entryCount: 0,
          totalDbEntries: 0,
          error: lmdbRefusalMessage(locale, refusal),
          activeKeyRegex: null,
          timelineRuleRows: buildLmdbTimelineRuleRowsForOpenFile(full, null)
        }
      }
      const keyRx = getTimelineKeyRegexForOpenPath(rootFolderPath, relativePath)
      const activeForRows = keyRx.error ? null : (keyRx.activeRuleId ?? null)
      const timelineRuleRows = buildLmdbTimelineRuleRowsForOpenFile(full, activeForRows)
      if (keyRx.error) {
        return {
          minMs: 0,
          maxMs: 0,
          entryCount: 0,
          totalDbEntries: 0,
          error: keyRx.error,
          activeKeyRegex: null,
          timelineRuleRows
        }
      }
      const bounds = await getLmdbTimelineBounds(full, keyRx.regexStr)
      return {
        ...bounds,
        activeKeyRegex: keyRx.regexStr ?? null,
        timelineRuleRows
      }
    }
  )

  ipcMain.handle(
    'lmdb:timelineQuery',
    async (
      _,
      rootFolderPath: string,
      relativePath: string,
      startMs: number,
      endMs: number
    ) => {
      if (typeof rootFolderPath !== 'string' || typeof relativePath !== 'string') {
        return { rows: [], truncated: false, error: 'Invalid path' }
      }
      if (typeof startMs !== 'number' || typeof endMs !== 'number' || !Number.isFinite(startMs + endMs)) {
        return { rows: [], truncated: false, error: 'Invalid range' }
      }
      const full = assertPathInsideRoot(rootFolderPath, relativePath)
      const locale = getAppLocale()
      const refusal = await getLmdbRefusalReason(full)
      if (refusal !== null) {
        return { rows: [], truncated: false, error: lmdbRefusalMessage(locale, refusal) }
      }
      const keyRx = getTimelineKeyRegexForOpenPath(rootFolderPath, relativePath)
      if (keyRx.error) {
        return { rows: [], truncated: false, error: keyRx.error }
      }
      return queryLmdbTimelineRange(full, startMs, endMs, keyRx.regexStr)
    }
  )

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
      const absPath = normalizePathKey(path.join(payload.rootPath, payload.relativePath))
      const wr = getWorkspaceRoot()
      const rel = wr ? toWorkspaceRelative(wr, absPath) : null
      const favIdx = findFavoriteIndex(absPath)
      const isFav = favIdx >= 0
      const canAddFavorite = rel !== null
      const hasKey = Boolean(getStoreKeyFromEnv())
      const isGeoJsonFile = payload.relativePath
        .replace(/\\/g, '/')
        .toLowerCase()
        .endsWith('.geojson')
      const geoIdx =
        isGeoJsonFile && rel !== null
          ? findGeoJsonLayerIndexByRelativePath(rel)
          : -1
      const onGeoMap = geoIdx >= 0
      const geoBlock: MenuItemConstructorOptions[] = isGeoJsonFile
        ? [
            {
              label: onGeoMap
                ? MAIN_I18N[locale].geoMapRemoveFromMap
                : MAIN_I18N[locale].geoMapAddToMap,
              enabled: rel !== null,
              click: (): void => {
                if (rel === null) return
                let list = getGeoJsonLayers()
                if (onGeoMap) {
                  list = list.filter((_, i) => i !== geoIdx)
                } else {
                  list.push({
                    id: randomUUID(),
                    relativePath: normalizeStoredRel(rel),
                    label: path.basename(absPath),
                    mapIcon: DEFAULT_GEO_MAP_ICON
                  })
                  createMapWindow()
                }
                appStore.set('geoJsonMapLayers', list)
                notifyGeoJsonMapLayersChanged()
              }
            },
            { type: 'separator' }
          ]
        : []
      const storedConfigRel = getWorkspaceConfigFileRelativePath()
      const isThisWorkspaceConfigFile =
        rel !== null &&
        storedConfigRel !== '' &&
        normalizeStoredRel(rel) === normalizeStoredRel(storedConfigRel)
      const configBlock: MenuItemConstructorOptions[] = [
        {
          label: isThisWorkspaceConfigFile
            ? MAIN_I18N[locale].workspaceConfigClear
            : MAIN_I18N[locale].workspaceConfigSet,
          enabled: rel !== null,
          click: (): void => {
            if (rel === null) return
            if (isThisWorkspaceConfigFile) {
              appStore.set('workspaceConfigFileRelativePath', '')
            } else {
              appStore.set(
                'workspaceConfigFileRelativePath',
                normalizeStoredRel(rel)
              )
            }
            notifyWorkspaceConfigFileChanged()
          }
        },
        { type: 'separator' }
      ]
      const menu = Menu.buildFromTemplate([
        {
          label: isFav
            ? MAIN_I18N[locale].favoriteRemoveFrom
            : MAIN_I18N[locale].favoriteAddTo,
          enabled: isFav || canAddFavorite,
          click: (): void => {
            let favs = getFavoritesList()
            if (isFav) {
              favs = favs.filter((_, i) => i !== favIdx)
            } else {
              if (rel === null) return
              favs.push({
                id: randomUUID(),
                relativePath: normalizeStoredRel(rel),
                label: path.basename(absPath)
              })
            }
            appStore.set('favorites', favs)
            notifyFavoritesChanged()
          }
        },
        { type: 'separator' },
        ...geoBlock,
        ...configBlock,
        {
          label: MAIN_I18N[locale].filePreviewAutomatic,
          click: (): void => {
            applyFileReadMode(payload.relativePath, 'default')
          }
        },
        {
          label: MAIN_I18N[locale].filePreviewAsText,
          click: (): void => {
            applyFileReadMode(payload.relativePath, 'text')
          }
        },
        {
          label: MAIN_I18N[locale].filePreviewAsImage,
          click: (): void => {
            applyFileReadMode(payload.relativePath, 'image')
          }
        },
        { type: 'separator' },
        {
          label: MAIN_I18N[locale].fileReadAsEncrypted,
          enabled: hasKey,
          click: (): void => {
            if (!hasKey) return
            applyFileReadMode(
              payload.relativePath,
              'electron-store-encrypted'
            )
          }
        },
        {
          label: MAIN_I18N[locale].entryReadAsLmdb,
          enabled: !isGeoJsonFile,
          click: (): void => {
            applyFileReadMode(payload.relativePath, 'lmdb')
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
    (
      event,
      payload: { rootPath: string; relativePath: string; x: number; y: number }
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
      const absPath = normalizePathKey(path.join(payload.rootPath, payload.relativePath))
      const wr = getWorkspaceRoot()
      const rel = wr ? toWorkspaceRelative(wr, absPath) : null
      const favIdx = findFavoriteIndex(absPath)
      const isFav = favIdx >= 0
      const canAddFavorite = rel !== null
      const folderName =
        path.basename(payload.relativePath.trim()) || payload.relativePath.trim()
      const menu = Menu.buildFromTemplate([
        {
          label: isFav
            ? MAIN_I18N[locale].favoriteRemoveFrom
            : MAIN_I18N[locale].favoriteAddTo,
          enabled: isFav || canAddFavorite,
          click: (): void => {
            let favs = getFavoritesList()
            if (isFav) {
              favs = favs.filter((_, i) => i !== favIdx)
            } else {
              if (rel === null) return
              favs.push({
                id: randomUUID(),
                relativePath: normalizeStoredRel(rel),
                label: path.basename(absPath)
              })
            }
            appStore.set('favorites', favs)
            notifyFavoritesChanged()
          }
        },
        { type: 'separator' },
        {
          label: MAIN_I18N[locale].ignoreFolder,
          click: (): void => {
            const name = folderName.trim()
            const current = appStore.get('ignoredFolderNames', [])
            if (!current.includes(name)) {
              appStore.set('ignoredFolderNames', [...current, name])
            }
            notifyConfigChanged()
          }
        },
        { type: 'separator' },
        {
          label: MAIN_I18N[locale].folderBrowseNormal,
          click: (): void => {
            applyFileReadMode(payload.relativePath, 'default')
          }
        },
        {
          label: MAIN_I18N[locale].entryReadAsLmdb,
          click: (): void => {
            applyFileReadMode(payload.relativePath, 'lmdb')
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
    'favorite:contextMenu',
    (
      event,
      payload: { id?: string; x?: number; y?: number }
    ) => {
      if (!payload || typeof payload.id !== 'string' || !payload.id.trim()) return
      const favId = payload.id.trim()
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return
      const fav = getFavoritesList().find((f) => f.id === favId)
      if (!fav) return
      const locale = getAppLocale()
      const menu = Menu.buildFromTemplate([
        {
          label: MAIN_I18N[locale].favoriteRemoveFrom,
          click: (): void => {
            const next = getFavoritesList().filter((f) => f.id !== fav.id)
            appStore.set('favorites', next)
            notifyFavoritesChanged()
          }
        }
      ])
      menu.popup({
        window: win,
        x: Math.round(payload.x ?? 0),
        y: Math.round(payload.y ?? 0)
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
