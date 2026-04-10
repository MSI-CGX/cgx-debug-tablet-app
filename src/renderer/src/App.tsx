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
import LogHighlightedPre from '@/components/LogHighlightedPre'
import i18n from '@/i18n/config'
import { Button } from '@/components/ui/button'
import SettingsView from './SettingsView'

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
  const [error, setError] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [readLoading, setReadLoading] = useState(false)
  const selectedPathRef = useRef<string | null>(null)

  useEffect(() => {
    const setLang = (lng: string): void => {
      document.documentElement.lang = lng
    }
    setLang(i18n.language)
    i18n.on('languageChanged', setLang)
    return (): void => {
      i18n.off('languageChanged', setLang)
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
          const res = await window.api.previewLmdbAt(rootPath, entry.relativePath)
          if (res.error) {
            setError(res.error)
          } else if (res.keys.length === 0) {
            setContent(t('lmdb.empty'))
          } else {
            setContent(res.keys.join('\n'))
          }
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
    [rootPath, t]
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

  return (
    <div className="layout">
      <header className="header">
        <div className="header-brand">
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
              <h2>{t('app.previewTitle')}</h2>
              <div className="preview-scroll">
                {readLoading && <p className="muted">{t('app.readingFile')}</p>}
                {selectedEntry && !readLoading && imagePreviewUrl ? (
                  <img
                    className="preview-image"
                    src={imagePreviewUrl}
                    alt={selectedEntry.name}
                  />
                ) : null}
                {selectedEntry && !readLoading && !imagePreviewUrl && useLogHighlight ? (
                  <LogHighlightedPre content={content} rules={logHighlightRules} />
                ) : null}
                {selectedEntry && !readLoading && !imagePreviewUrl && !useLogHighlight ? (
                  <pre className="content">{content}</pre>
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
