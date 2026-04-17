import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import type {
  FavoriteEntry,
  FolderEntry,
  GeoJsonMapLayerEntry,
  LogHighlightRule
} from '../../preload/types'
import JsonConfigTree from '@/components/JsonConfigTree'
import LmdbTimelineViewer from '@/components/LmdbTimelineViewer'
import LogHighlightedPre from '@/components/LogHighlightedPre'
import {
  isPathExcludedByRules,
  normalizeExcludedPathLine,
  parseDottedPath
} from '../../common/configExcludedPaths'
import {
  colorForLogFilterLevel,
  foregroundOnAccent
} from '@/lib/logLineColor'
import {
  DEFAULT_LOG_LEVEL_VISIBILITY,
  LOG_LEVEL_ORDER,
  filterLogContentByLevels,
  type LogLineLevel
} from '@/lib/logLineLevel'
import i18n from '@/i18n/config'
import { Button } from '@/components/ui/button'
import SettingsView from './SettingsView'
import logoSplashUrl from '@resources/logo_splash.svg?url'
import ReactJson from 'react-json-view'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Join root and relative segment for display (native-style separators). */
function joinRootDisplay(root: string, relativeDir: string): string {
  if (!relativeDir) return root
  const sep = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[/\\]+$/, '')}${sep}${relativeDir.replace(/^[/\\]+/, '')}`
}

function parentRelativePath(relativeDir: string): string {
  if (!relativeDir) return ''
  const parts = relativeDir.split(/[/\\]/)
  parts.pop()
  return parts.join(relativeDir.includes('\\') ? '\\' : '/')
}

function pathBasename(absolutePath: string): string {
  const trimmed = absolutePath.replace(/[/\\]+$/, '')
  const parts = trimmed.split(/[/\\]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1]! : absolutePath
}

/** True for typical log filenames: *.log, *.log.* (rotated), etc. */
function isLogLikeFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.log')) return true
  // Rotated / split: app.log.1, app.log.old
  return /\.log\./.test(lower)
}

/** If the whole buffer looks like JSON object/array, return parsed value; otherwise null. */
function tryParseJsonText(raw: string): unknown | null {
  const t = raw.trim()
  if (t.length === 0) return null
  const first = t[0]
  if (first !== '{' && first !== '[') return null
  try {
    return JSON.parse(t) as unknown
  } catch {
    return null
  }
}

/** Parse common log timestamps from a line. */
function parseLogLineTimestampMs(line: string): number | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  // ISO-ish date time (YYYY-MM-DD HH:mm:ss(.sss) with optional TZ).
  const isoLike = trimmed.match(
    /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/
  )
  if (isoLike) {
    const candidate = isoLike[0].replace(',', '.')
    const d = Date.parse(candidate)
    if (!Number.isNaN(d)) return d
  }

  // Bracketed common format: [2026-04-16 10:23:01.123]
  const bracketed = trimmed.match(
    /\[(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\]/
  )
  if (bracketed) {
    const d = Date.parse(bracketed[1].replace(',', '.').replace(' ', 'T'))
    if (!Number.isNaN(d)) return d
  }

  // Epoch at line start (seconds or milliseconds).
  const epochStart = trimmed.match(/^(\d{10}|\d{13})(?!\d)/)
  if (epochStart) {
    const raw = Number(epochStart[1])
    if (Number.isFinite(raw)) {
      return epochStart[1].length === 10 ? raw * 1000 : raw
    }
  }
  return null
}

function filterLogContentByTimeRange(
  content: string,
  startMs: number | null,
  endMs: number | null
): string {
  if (startMs === null && endMs === null) return content
  const lo = startMs ?? Number.NEGATIVE_INFINITY
  const hi = endMs ?? Number.POSITIVE_INFINITY
  const lines = content.split(/\r?\n/)
  const out: string[] = []
  let prevIncluded = false
  for (const line of lines) {
    const ts = parseLogLineTimestampMs(line)
    if (ts !== null) {
      const keep = ts >= lo && ts <= hi
      if (keep) out.push(line)
      prevIncluded = keep
      continue
    }
    // Preserve stacktrace/continuation lines only for matching log records.
    if (prevIncluded) {
      out.push(line)
    }
  }
  return out.join('\n')
}

/** Keep lines whose text contains the query (case-insensitive). Empty query = no filter. */
function filterLogContentByText(content: string, query: string): string {
  const q = query.trim()
  if (!q) return content
  const lower = q.toLowerCase()
  const lines = content.split(/\r?\n/)
  return lines.filter((line) => line.toLowerCase().includes(lower)).join('\n')
}

function normalizePathForCompare(p: string): string {
  return p.replace(/\\/g, '/')
}

function pathSeparatorFor(rootPath: string, relativeDir: string): '\\' | '/' {
  if (relativeDir.includes('\\')) return '\\'
  if (relativeDir.includes('/')) return '/'
  return rootPath.includes('\\') ? '\\' : '/'
}

type BreadcrumbItem = {
  label: string
  relativePath: string
}

function buildBreadcrumbItems(
  rootPath: string,
  relativeDir: string
): BreadcrumbItem[] {
  const rootLabel = pathBasename(rootPath)
  const sep = pathSeparatorFor(rootPath, relativeDir)
  const parts = relativeDir.split(/[/\\]+/).filter(Boolean)
  const items: BreadcrumbItem[] = [{ label: rootLabel, relativePath: '' }]
  const acc: string[] = []
  for (const part of parts) {
    acc.push(part)
    items.push({ label: part, relativePath: acc.join(sep) })
  }
  return items
}

type Page = 'explorer' | 'settings'

export default function App(): JSX.Element {
  const { t } = useTranslation()
  const [page, setPage] = useState<Page>('explorer')
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [relativeDir, setRelativeDir] = useState('')
  const [entries, setEntries] = useState<FolderEntry[]>([])
  const [selectedEntry, setSelectedEntry] = useState<FolderEntry | null>(null)
  const [content, setContent] = useState<string>('')
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [logHighlightRules, setLogHighlightRules] = useState<LogHighlightRule[]>([])
  const [logHighlightForAllText, setLogHighlightForAllText] = useState(false)
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([])
  const [geoJsonMapLayers, setGeoJsonMapLayers] = useState<GeoJsonMapLayerEntry[]>([])
  const [workspaceConfigFilePath, setWorkspaceConfigFilePath] = useState('')
  const [configFormExcludedPaths, setConfigFormExcludedPaths] = useState<string[]>(
    []
  )
  const [configJsonPreview, setConfigJsonPreview] = useState<
    { ok: true; data: unknown } | { ok: false; error: string } | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [readLoading, setReadLoading] = useState(false)
  const [logLevelVisibility, setLogLevelVisibility] = useState<
    Record<LogLineLevel, boolean>
  >(() => ({ ...DEFAULT_LOG_LEVEL_VISIBILITY }))
  const [logTimeStartInput, setLogTimeStartInput] = useState('')
  const [logTimeEndInput, setLogTimeEndInput] = useState('')
  const [logTextFilter, setLogTextFilter] = useState('')
  const selectedPathRef = useRef<string | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const logTimeStartRef = useRef<HTMLInputElement | null>(null)
  const logTimeEndRef = useRef<HTMLInputElement | null>(null)

  const scrollPreviewToTop = useCallback((): void => {
    previewScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const syncDocumentLangAndTitle = (): void => {
      document.documentElement.lang = i18n.language
      document.title = i18n.t('app.title')
    }
    syncDocumentLangAndTitle()
    i18n.on('languageChanged', syncDocumentLangAndTitle)
    return (): void => {
      i18n.off('languageChanged', syncDocumentLangAndTitle)
    }
  }, [])

  useEffect(() => {
    const unsub = window.api.subscribeLocaleChanged((locale) => {
      void i18n.changeLanguage(locale)
    })
    return unsub
  }, [])

  useEffect(() => {
    const loadLogSettings = async (): Promise<void> => {
      const snap = await window.api.getConfigSnapshot()
      setLogHighlightRules(snap.logHighlightRules)
      setLogHighlightForAllText(snap.logHighlightForAllTextFiles)
    }
    void loadLogSettings()
    const unsub = window.api.subscribeLogRulesChanged(() => {
      void loadLogSettings()
    })
    return unsub
  }, [])

  const refreshFavorites = useCallback(async () => {
    const snap = await window.api.getConfigSnapshot()
    setFavorites(snap.favorites)
  }, [])

  useEffect(() => {
    void refreshFavorites()
    const unsub = window.api.subscribeFavoritesChanged(() => {
      void refreshFavorites()
    })
    return unsub
  }, [refreshFavorites])

  const refreshGeoJsonMapLayers = useCallback(async () => {
    const snap = await window.api.getConfigSnapshot()
    setGeoJsonMapLayers(snap.geoJsonMapLayers ?? [])
  }, [])

  useEffect(() => {
    void refreshGeoJsonMapLayers()
    const unsub = window.api.subscribeGeoJsonMapLayersChanged(() => {
      void refreshGeoJsonMapLayers()
    })
    return unsub
  }, [refreshGeoJsonMapLayers])

  const refreshWorkspaceConfigPath = useCallback(async () => {
    const snap = await window.api.getConfigSnapshot()
    setWorkspaceConfigFilePath(snap.workspaceConfigFileRelativePath ?? '')
  }, [])

  useEffect(() => {
    void refreshWorkspaceConfigPath()
    const unsub = window.api.subscribeWorkspaceConfigFileChanged(() => {
      void refreshWorkspaceConfigPath()
    })
    return unsub
  }, [refreshWorkspaceConfigPath])

  const refreshConfigFormExcludedPaths = useCallback(async () => {
    const snap = await window.api.getConfigSnapshot()
    setConfigFormExcludedPaths(snap.configFormExcludedPaths ?? [])
  }, [])

  useEffect(() => {
    void refreshConfigFormExcludedPaths()
    const unsub = window.api.subscribeConfigFormExcludedPathsChanged(() => {
      void refreshConfigFormExcludedPaths()
    })
    return unsub
  }, [refreshConfigFormExcludedPaths])

  useEffect(() => {
    setLogLevelVisibility({ ...DEFAULT_LOG_LEVEL_VISIBILITY })
    setLogTimeStartInput('')
    setLogTimeEndInput('')
    setLogTextFilter('')
  }, [selectedEntry?.relativePath])

  const addExcludedPathFromTree = useCallback(
    async (dottedPath: string): Promise<void> => {
      const n = normalizeExcludedPathLine(dottedPath)
      if (!n) return
      const segs = parseDottedPath(n)
      if (!segs) return
      const concrete = segs.filter((s): s is string | number => s !== '*')
      if (concrete.length !== segs.length) return
      if (isPathExcludedByRules(concrete, configFormExcludedPaths)) return
      const next = [...new Set([...configFormExcludedPaths, n])].sort((a, b) =>
        a.localeCompare(b)
      )
      await window.api.setConfigFormExcludedPaths(next)
    },
    [configFormExcludedPaths]
  )

  useEffect(() => {
    if (!selectedEntry || selectedEntry.kind !== 'file') {
      setConfigJsonPreview(null)
      return
    }
    if (selectedEntry.readMode === 'image' || selectedEntry.readMode === 'lmdb') {
      setConfigJsonPreview(null)
      return
    }
    if (!workspaceConfigFilePath) {
      setConfigJsonPreview(null)
      return
    }
    if (
      normalizePathForCompare(selectedEntry.relativePath) !==
      normalizePathForCompare(workspaceConfigFilePath)
    ) {
      setConfigJsonPreview(null)
      return
    }
    if (!content) {
      setConfigJsonPreview(null)
      return
    }
    try {
      setConfigJsonPreview({ ok: true, data: JSON.parse(content) })
    } catch (e) {
      setConfigJsonPreview({
        ok: false,
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }, [selectedEntry, content, workspaceConfigFilePath])

  const geoJsonPathSet = useMemo(() => {
    const s = new Set<string>()
    for (const l of geoJsonMapLayers) {
      s.add(normalizePathForCompare(l.relativePath))
    }
    return s
  }, [geoJsonMapLayers])

  const loadContents = useCallback(async (folderRoot: string, subPath: string) => {
    setError(null)
    setListLoading(true)
    setSelectedEntry(null)
    setContent('')
    setImagePreviewUrl(null)
    try {
      const list = await window.api.listFolderContents(folderRoot, subPath)
      setEntries(list)
      return list
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setEntries([])
      return []
    } finally {
      setListLoading(false)
    }
  }, [])

  const reloadExplorerIfNeeded = useCallback(async () => {
    if (rootPath) {
      await loadContents(rootPath, relativeDir)
    }
  }, [rootPath, relativeDir, loadContents])

  useEffect(() => {
    const unsub = window.api.subscribeIgnoredFoldersChanged(() => {
      void reloadExplorerIfNeeded()
    })
    return unsub
  }, [reloadExplorerIfNeeded])

  const loadEntryPreview = useCallback(
    async (entry: FolderEntry): Promise<void> => {
      if (!rootPath) return
      setError(null)
      setReadLoading(true)
      setContent('')
      setImagePreviewUrl(null)
      try {
        if (entry.readMode === 'lmdb') {
          setContent('')
        } else if (entry.kind === 'file' && entry.readMode === 'image') {
          const res = await window.api.readImagePreview(rootPath, entry.relativePath)
          setImagePreviewUrl(`data:${res.mime};base64,${res.dataBase64}`)
        } else if (entry.kind === 'file') {
          const text = await window.api.readFileText(rootPath, entry.relativePath)
          setContent(text)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setReadLoading(false)
      }
    },
    [rootPath]
  )

  useEffect(() => {
    selectedPathRef.current = selectedEntry?.relativePath ?? null
  }, [selectedEntry])

  useEffect(() => {
    const unsub = window.api.subscribeFileBindingsChanged(() => {
      void (async () => {
        if (!rootPath) return
        const list = await window.api.listFolderContents(rootPath, relativeDir)
        setEntries(list)
        const p = selectedPathRef.current
        if (!p) return
        const next = list.find((e) => e.relativePath === p)
        if (!next) return
        setSelectedEntry(next)
        if (next.kind === 'file' || next.readMode === 'lmdb') {
          await loadEntryPreview(next)
        }
      })()
    })
    return unsub
  }, [rootPath, relativeDir, loadEntryPreview])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const snap = await window.api.getConfigSnapshot()
      if (cancelled || !snap.workspaceRoot) return
      setRootPath(snap.workspaceRoot)
      setRelativeDir('')
      await loadContents(snap.workspaceRoot, '')
    })()
    return () => {
      cancelled = true
    }
  }, [loadContents])

  const handleFavoriteOpen = useCallback(
    async (id: string): Promise<void> => {
      setError(null)
      const res = await window.api.openFavorite(id)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setPage('explorer')
      setRootPath(res.rootPath)
      setRelativeDir(res.relativeDir)
      const list = await loadContents(res.rootPath, res.relativeDir)
      if (res.selectRelativePath) {
        const target = normalizePathForCompare(res.selectRelativePath)
        const match = list.find(
          (e) =>
            e.kind === 'file' &&
            normalizePathForCompare(e.relativePath) === target
        )
        if (match) {
          setSelectedEntry(match)
          await loadEntryPreview(match)
        }
      }
    },
    [loadContents, loadEntryPreview]
  )

  const handleFavoriteContextMenu = (e: MouseEvent, favoriteId: string): void => {
    e.preventDefault()
    e.stopPropagation()
    window.api.showFavoriteContextMenu(favoriteId, e.screenX, e.screenY)
  }

  const handleOpenFolder = async (): Promise<void> => {
    setError(null)
    const picked = await window.api.openFolder()
    if (!picked) return
    setRootPath(picked)
    setRelativeDir('')
    await loadContents(picked, '')
  }

  const handleGoUp = (): void => {
    if (!rootPath) return
    const parent = parentRelativePath(relativeDir)
    setRelativeDir(parent)
    void loadContents(rootPath, parent)
  }

  const handleBreadcrumbNavigate = (targetRelativePath: string): void => {
    if (!rootPath) return
    setRelativeDir(targetRelativePath)
    void loadContents(rootPath, targetRelativePath)
  }

  const breadcrumbItems = useMemo(() => {
    if (!rootPath) return []
    const items = buildBreadcrumbItems(rootPath, relativeDir)
    if (selectedEntry?.kind === 'file') {
      return [...items, { label: selectedEntry.name, relativePath: '\u0000file' }]
    }
    return items
  }, [rootPath, relativeDir, selectedEntry])

  const handleSelectFile = async (file: FolderEntry): Promise<void> => {
    if (!rootPath || file.kind !== 'file') return
    setSelectedEntry(file)
    await loadEntryPreview(file)
  }

  const handleEnterDirectoryFromList = (dir: FolderEntry): void => {
    if (!rootPath || dir.kind !== 'directory') return
    setRelativeDir(dir.relativePath)
    void loadContents(rootPath, dir.relativePath)
  }

  const handleDirectoryClick = (entry: FolderEntry, e: MouseEvent): void => {
    if (!rootPath || entry.kind !== 'directory') return
    if (entry.readMode === 'lmdb') {
      if (e.detail === 2) {
        handleEnterDirectoryFromList(entry)
      } else if (e.detail === 1) {
        setSelectedEntry(entry)
        void loadEntryPreview(entry)
      }
    } else {
      handleEnterDirectoryFromList(entry)
    }
  }

  const handleFolderContextMenu = (e: MouseEvent, entry: FolderEntry): void => {
    e.preventDefault()
    e.stopPropagation()
    if (!rootPath || entry.kind !== 'directory') return
    window.api.showFolderContextMenu(rootPath, entry.relativePath, e.screenX, e.screenY)
  }

  const handleFileContextMenu = (e: MouseEvent, entry: FolderEntry): void => {
    e.preventDefault()
    e.stopPropagation()
    if (!rootPath || entry.kind !== 'file') return
    window.api.showFileContextMenu(rootPath, entry.relativePath, e.screenX, e.screenY)
  }

  const currentFullPath =
    rootPath && relativeDir ? joinRootDisplay(rootPath, relativeDir) : rootPath

  const useLogHighlight =
    selectedEntry?.kind === 'file' &&
    !imagePreviewUrl &&
    logHighlightRules.length > 0 &&
    (logHighlightForAllText || isLogLikeFileName(selectedEntry.name))

  const isFileOnGeoMap = (entry: FolderEntry): boolean =>
    entry.kind === 'file' && geoJsonPathSet.has(normalizePathForCompare(entry.relativePath))

  const isWorkspaceConfigFile = (entry: FolderEntry): boolean =>
    entry.kind === 'file' &&
    workspaceConfigFilePath !== '' &&
    normalizePathForCompare(entry.relativePath) ===
      normalizePathForCompare(workspaceConfigFilePath)

  const showConfigFormPreview =
    selectedEntry?.kind === 'file' &&
    selectedEntry.readMode !== 'image' &&
    configJsonPreview?.ok === true

  const isLogFileTextPreview =
    selectedEntry?.kind === 'file' &&
    isLogLikeFileName(selectedEntry.name) &&
    !imagePreviewUrl &&
    !showConfigFormPreview

  const displayPreviewText = useMemo(() => {
    if (!isLogFileTextPreview) return content
    const byLevel = filterLogContentByLevels(content, logLevelVisibility)
    const startMs = logTimeStartInput ? Date.parse(logTimeStartInput) : NaN
    const endMs = logTimeEndInput ? Date.parse(logTimeEndInput) : NaN
    const byTime = filterLogContentByTimeRange(
      byLevel,
      Number.isNaN(startMs) ? null : startMs,
      Number.isNaN(endMs) ? null : endMs
    )
    return filterLogContentByText(byTime, logTextFilter)
  }, [
    content,
    isLogFileTextPreview,
    logLevelVisibility,
    logTimeStartInput,
    logTimeEndInput,
    logTextFilter
  ])

  const showLogLevelToolbar =
    selectedEntry?.kind === 'file' &&
    isLogLikeFileName(selectedEntry.name) &&
    !readLoading &&
    !imagePreviewUrl &&
    !showConfigFormPreview

  const showLogPreviewEmpty =
    isLogFileTextPreview &&
    displayPreviewText === '' &&
    content.length > 0

  const plainPreviewJson = useMemo((): unknown | null => {
    if (!selectedEntry || selectedEntry.kind !== 'file') return null
    if (readLoading || imagePreviewUrl) return null
    if (showConfigFormPreview) return null
    if (useLogHighlight) return null
    if (selectedEntry.readMode === 'lmdb') return null
    if (
      configJsonPreview?.ok === false &&
      workspaceConfigFilePath !== '' &&
      normalizePathForCompare(selectedEntry.relativePath) ===
        normalizePathForCompare(workspaceConfigFilePath)
    ) {
      return null
    }
    return tryParseJsonText(displayPreviewText)
  }, [
    selectedEntry,
    readLoading,
    imagePreviewUrl,
    showConfigFormPreview,
    useLogHighlight,
    configJsonPreview,
    workspaceConfigFilePath,
    displayPreviewText
  ])

  const openNativeDateTimePicker = (el: HTMLInputElement | null): void => {
    if (!el) return
    try {
      el.showPicker()
    } catch {
      el.focus()
    }
  }

  return (
    <div className="layout">
      <header className="header">
        <div className="header-brand">
          <img
            src={logoSplashUrl}
            alt=""
            className="header-logo"
            width={36}
            height={36}
            decoding="async"
          />
          <h1>{t('app.title')}</h1>
        </div>
        <div className="header-center">
          <nav className="nav-tabs" aria-label={t('app.navMain')}>
            <button
              type="button"
              className={page === 'explorer' ? 'nav-tab active' : 'nav-tab'}
              onClick={() => setPage('explorer')}
            >
              {t('app.navExplorer')}
            </button>
            <button
              type="button"
              className={page === 'settings' ? 'nav-tab active' : 'nav-tab'}
              onClick={() => setPage('settings')}
            >
              {t('app.navSettings')}
            </button>
          </nav>
          {favorites.length > 0 ? (
            <div
              className="header-favorites"
              role="toolbar"
              aria-label={t('app.favoritesAria')}
            >
              {favorites.map((f) => (
                <Button
                  key={f.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="favorite-chip"
                  title={f.relativePath}
                  onClick={() => void handleFavoriteOpen(f.id)}
                  onContextMenu={(e) => handleFavoriteContextMenu(e, f.id)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="header-trailing header-trailing-actions">
          {page === 'explorer' && (
            <>
              <Button type="button" variant="outline" onClick={() => window.api.openMapWindow()}>
                {t('app.openMap')}
              </Button>
              <Button type="button" onClick={handleOpenFolder}>
                {t('app.openFolder')}
              </Button>
            </>
          )}
        </div>
      </header>

      {page === 'settings' ? (
        <div className="workspace">
          <SettingsView onConfigChanged={reloadExplorerIfNeeded} />
        </div>
      ) : (
        <div className="workspace">
          {rootPath && (
            <div className="path-row">
              <nav
                className="breadcrumb"
                aria-label={t('app.breadcrumbAria')}
                title={currentFullPath ?? rootPath}
              >
                <ol className="breadcrumb-list">
                  {breadcrumbItems.map((item, index) => {
                    const isLast = index === breadcrumbItems.length - 1
                    return (
                      <li key={`${item.relativePath}:${index}`} className="breadcrumb-li">
                        {index > 0 ? (
                          <ChevronRight
                            className="breadcrumb-chevron"
                            aria-hidden
                            size={14}
                            strokeWidth={2}
                          />
                        ) : null}
                        {isLast ? (
                          <span className="breadcrumb-current">{item.label}</span>
                        ) : (
                          <button
                            type="button"
                            className="breadcrumb-link"
                            onClick={() => handleBreadcrumbNavigate(item.relativePath)}
                          >
                            {item.label}
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </nav>
              {relativeDir ? (
                <Button type="button" variant="outline" size="sm" onClick={handleGoUp}>
                  {t('app.up')}
                </Button>
              ) : null}
            </div>
          )}

          {error && <div className="banner error">{error}</div>}

          <div className="panels">
            <aside className="sidebar">
              <h2>{t('app.sidebarTitle')}</h2>
              {!rootPath && <p className="muted">{t('app.chooseFolder')}</p>}
              {rootPath && listLoading && <p className="muted">{t('app.loading')}</p>}
              {rootPath && !listLoading && entries.length === 0 && (
                <p className="muted">{t('app.folderEmpty')}</p>
              )}
              <ul className="file-list">
                {entries.map((entry) => {
                  const isSelected =
                    selectedEntry?.relativePath === entry.relativePath &&
                    (entry.kind === 'file' || entry.readMode === 'lmdb')
                  return (
                  <li key={`${entry.kind}:${entry.relativePath}`}>
                    {entry.kind === 'directory' ? (
                      <button
                        type="button"
                        className={isSelected ? 'file dir active' : 'file dir'}
                        onClick={(e) => handleDirectoryClick(entry, e)}
                        onContextMenu={(e) => handleFolderContextMenu(e, entry)}
                      >
                        <span className="file-name">
                          <span className="badge folder">{t('app.folderBadge')}</span>
                          {entry.readMode === 'lmdb' ? (
                            <span className="badge lmdb" title={t('app.lmdbBadgeHint')}>
                              {t('app.lmdbBadge')}
                            </span>
                          ) : null}
                          {entry.name}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={isSelected ? 'file active' : 'file'}
                        onClick={() => handleSelectFile(entry)}
                        onContextMenu={(e) => handleFileContextMenu(e, entry)}
                      >
                        <span className="file-name">
                          {entry.readMode === 'electron-store-encrypted' ? (
                            <span className="badge encrypted" title={t('app.encryptedBadgeHint')}>
                              {t('app.encryptedBadge')}
                            </span>
                          ) : null}
                          {entry.readMode === 'lmdb' ? (
                            <span className="badge lmdb" title={t('app.lmdbBadgeHint')}>
                              {t('app.lmdbBadge')}
                            </span>
                          ) : null}
                          {entry.readMode === 'image' ? (
                            <span className="badge image" title={t('app.imageBadgeHint')}>
                              {t('app.imageBadge')}
                            </span>
                          ) : null}
                          {isFileOnGeoMap(entry) ? (
                            <span className="badge map" title={t('app.mapBadgeHint')}>
                              {t('app.mapBadge')}
                            </span>
                          ) : null}
                          {isWorkspaceConfigFile(entry) ? (
                            <span className="badge config" title={t('app.configFileBadgeHint')}>
                              {t('app.configFileBadge')}
                            </span>
                          ) : null}
                          {entry.name}
                        </span>
                        <span className="file-size">{formatBytes(entry.size ?? 0)}</span>
                      </button>
                    )}
                  </li>
                  )
                })}
              </ul>
            </aside>

            <main className="preview">
              <div className="preview-head">
                <h2>{t('app.previewTitle')}</h2>
                {showLogLevelToolbar ? (
                  <div className="log-filters">
                    <div
                      className="log-level-toggles"
                      role="group"
                      aria-label={t('app.logLevelFilterAria')}
                    >
                      {LOG_LEVEL_ORDER.map((level) => {
                        const accent = colorForLogFilterLevel(level, logHighlightRules)
                        const on = logLevelVisibility[level]
                        const themed = Boolean(accent)
                        const style =
                          themed && accent
                            ? on
                              ? {
                                  backgroundColor: accent,
                                  color: foregroundOnAccent(accent),
                                  borderColor: accent
                                }
                              : {
                                  backgroundColor: 'transparent',
                                  color: accent,
                                  borderColor: accent
                                }
                            : undefined
                        return (
                          <Button
                            key={level}
                            type="button"
                            size="sm"
                            variant={themed ? 'outline' : on ? 'default' : 'outline'}
                            className={
                              themed ? 'log-level-toggle log-level-toggle--accent' : 'log-level-toggle'
                            }
                            style={style}
                            aria-pressed={on}
                            onClick={() =>
                              setLogLevelVisibility((prev) => ({
                                ...prev,
                                [level]: !prev[level]
                              }))
                            }
                          >
                            {t(`app.logLevel.${level}`)}
                          </Button>
                        )
                      })}
                    </div>
                    <div className="log-time-filter" aria-label={t('app.logTimeFilterAria')}>
                      <label className="log-time-filter-label">
                        <span>{t('app.logTimeFrom')}</span>
                        <input
                          ref={logTimeStartRef}
                          type="datetime-local"
                          className="input log-time-filter-input"
                          value={logTimeStartInput}
                          step={1}
                          onChange={(e) => setLogTimeStartInput(e.target.value)}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="log-time-picker-btn"
                          title={t('app.logTimeOpenPicker')}
                          onClick={() => openNativeDateTimePicker(logTimeStartRef.current)}
                        >
                          {t('app.logTimePickerBtn')}
                        </Button>
                      </label>
                      <label className="log-time-filter-label">
                        <span>{t('app.logTimeTo')}</span>
                        <input
                          ref={logTimeEndRef}
                          type="datetime-local"
                          className="input log-time-filter-input"
                          value={logTimeEndInput}
                          step={1}
                          onChange={(e) => setLogTimeEndInput(e.target.value)}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="log-time-picker-btn"
                          title={t('app.logTimeOpenPicker')}
                          onClick={() => openNativeDateTimePicker(logTimeEndRef.current)}
                        >
                          {t('app.logTimePickerBtn')}
                        </Button>
                      </label>
                    </div>
                    <div className="log-text-filter">
                      <label className="log-text-filter-label" htmlFor="log-text-filter-input">
                        {t('app.logTextFilterLabel')}
                      </label>
                      <input
                        id="log-text-filter-input"
                        type="search"
                        className="input log-text-filter-input"
                        value={logTextFilter}
                        onChange={(e) => setLogTextFilter(e.target.value)}
                        placeholder={t('app.logTextFilterPlaceholder')}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={t('app.logTextFilterAria')}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="preview-scroll" ref={previewScrollRef}>
                {readLoading && <p className="muted">{t('app.readingFile')}</p>}
                {selectedEntry && !readLoading && imagePreviewUrl ? (
                  <img
                    className="preview-image"
                    src={imagePreviewUrl}
                    alt={selectedEntry.name}
                  />
                ) : null}
                {selectedEntry &&
                !readLoading &&
                !imagePreviewUrl &&
                showConfigFormPreview &&
                configJsonPreview?.ok ? (
                  <div className="config-json-preview">
                    <div className="config-json-preview-sticky">
                      <div className="config-json-preview-sticky-inner">
                        <p className="config-json-preview-lead muted small">
                          {t('app.configPreviewLead')}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="config-json-scroll-root"
                          onClick={scrollPreviewToTop}
                        >
                          {t('app.configFormScrollToRoot')}
                        </Button>
                      </div>
                    </div>
                    <JsonConfigTree
                      key={workspaceConfigFilePath || 'config-preview'}
                      data={configJsonPreview.data}
                      excludedPathRules={configFormExcludedPaths}
                      onAddExcludedPath={addExcludedPathFromTree}
                    />
                  </div>
                ) : null}
                {selectedEntry &&
                !readLoading &&
                !imagePreviewUrl &&
                configJsonPreview?.ok === false &&
                isWorkspaceConfigFile(selectedEntry) ? (
                  <div className="config-json-error banner error">{configJsonPreview.error}</div>
                ) : null}
                {selectedEntry &&
                !readLoading &&
                !imagePreviewUrl &&
                configJsonPreview?.ok === false &&
                isWorkspaceConfigFile(selectedEntry) ? (
                  <pre className="content">{displayPreviewText}</pre>
                ) : null}
                {selectedEntry &&
                !readLoading &&
                !imagePreviewUrl &&
                rootPath &&
                selectedEntry.readMode === 'lmdb' ? (
                  <LmdbTimelineViewer rootPath={rootPath} relativePath={selectedEntry.relativePath} />
                ) : null}
                {selectedEntry &&
                !readLoading &&
                !imagePreviewUrl &&
                useLogHighlight &&
                !showConfigFormPreview &&
                selectedEntry.readMode !== 'lmdb' &&
                !(configJsonPreview?.ok === false && isWorkspaceConfigFile(selectedEntry)) ? (
                  showLogPreviewEmpty ? (
                    <p className="muted log-preview-empty">{t('app.logLevelAllHidden')}</p>
                  ) : (
                    <LogHighlightedPre content={displayPreviewText} rules={logHighlightRules} />
                  )
                ) : null}
                {selectedEntry &&
                !readLoading &&
                !imagePreviewUrl &&
                !useLogHighlight &&
                !showConfigFormPreview &&
                selectedEntry.readMode !== 'lmdb' &&
                !(configJsonPreview?.ok === false && isWorkspaceConfigFile(selectedEntry)) ? (
                  showLogPreviewEmpty ? (
                    <p className="muted log-preview-empty">{t('app.logLevelAllHidden')}</p>
                  ) : plainPreviewJson !== null ? (
                    <div className="preview-json-view-wrap">
                      <ReactJson
                        src={plainPreviewJson as object}
                        name={false}
                        theme="monokai"
                        collapsed={2}
                        enableClipboard
                        displayDataTypes={false}
                        displayObjectSize={false}
                      />
                    </div>
                  ) : (
                    <pre className="content">{displayPreviewText}</pre>
                  )
                ) : null}
                {!selectedEntry && !readLoading && (
                  <p className="muted preview-hint">{t('app.previewHint')}</p>
                )}
              </div>
            </main>
          </div>
        </div>
      )}
    </div>
  )
}
