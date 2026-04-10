import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import type { FolderEntry, LogColorRule } from '../../preload/types'
import i18n from '@/i18n/config'
import { Button } from '@/components/ui/button'
import LogHighlightedPre from '@/components/LogHighlightedPre'
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

function isLogFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.log')
}

export default function App(): JSX.Element {
  const { t } = useTranslation()
  const [page, setPage] = useState<Page>('explorer')
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [relativeDir, setRelativeDir] = useState('')
  const [entries, setEntries] = useState<FolderEntry[]>([])
  const [selectedFile, setSelectedFile] = useState<FolderEntry | null>(null)
  const [content, setContent] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [readLoading, setReadLoading] = useState(false)
  const [logColorRules, setLogColorRules] = useState<LogColorRule[]>([])

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

  const loadContents = useCallback(async (folderRoot: string, subPath: string) => {
    setError(null)
    setListLoading(true)
    setSelectedFile(null)
    setContent('')
    try {
      const list = await window.api.listFolderContents(folderRoot, subPath)
      setEntries(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setEntries([])
    } finally {
      setListLoading(false)
    }
  }, [])

  const reloadExplorerIfNeeded = useCallback(async () => {
    if (rootPath) {
      await loadContents(rootPath, relativeDir)
    }
  }, [rootPath, relativeDir, loadContents])

  const reloadAppConfig = useCallback(async () => {
    const snap = await window.api.getConfigSnapshot()
    setLogColorRules(snap.logColorRules)
  }, [])

  useEffect(() => {
    void reloadAppConfig()
  }, [reloadAppConfig])

  const handleConfigChanged = useCallback(async () => {
    await reloadExplorerIfNeeded()
    await reloadAppConfig()
  }, [reloadExplorerIfNeeded, reloadAppConfig])

  useEffect(() => {
    const unsub = window.api.subscribeIgnoredFoldersChanged(() => {
      void reloadExplorerIfNeeded()
    })
    return unsub
  }, [reloadExplorerIfNeeded])

  const handleOpenFolder = async (): Promise<void> => {
    setError(null)
    const picked = await window.api.openFolder()
    if (!picked) return
    setRootPath(picked)
    setRelativeDir('')
    await loadContents(picked, '')
  }

  const handleEnterDirectory = (dir: FolderEntry): void => {
    if (!rootPath || dir.kind !== 'directory') return
    setRelativeDir(dir.relativePath)
    void loadContents(rootPath, dir.relativePath)
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
    return buildBreadcrumbItems(rootPath, relativeDir)
  }, [rootPath, relativeDir])

  const handleSelectFile = async (file: FolderEntry): Promise<void> => {
    if (!rootPath || file.kind !== 'file') return
    setSelectedFile(file)
    setError(null)
    setReadLoading(true)
    setContent('')
    try {
      const text = await window.api.readFileText(rootPath, file.relativePath)
      setContent(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReadLoading(false)
    }
  }

  const handleFolderContextMenu = (e: MouseEvent, folderName: string): void => {
    e.preventDefault()
    e.stopPropagation()
    window.api.showFolderContextMenu(folderName, e.screenX, e.screenY)
  }

  const currentFullPath =
    rootPath && relativeDir ? joinRootDisplay(rootPath, relativeDir) : rootPath

  return (
    <div className="layout">
      <header className="header">
        <div className="header-brand">
          <h1>{t('app.title')}</h1>
        </div>
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
        <div className="header-trailing">
          {page === 'explorer' && (
            <Button type="button" onClick={handleOpenFolder}>
              {t('app.openFolder')}
            </Button>
          )}
        </div>
      </header>

      {page === 'settings' ? (
        <div className="workspace">
          <SettingsView onConfigChanged={handleConfigChanged} />
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
                {entries.map((entry) => (
                  <li key={`${entry.kind}:${entry.relativePath}`}>
                    {entry.kind === 'directory' ? (
                      <button
                        type="button"
                        className="file dir"
                        onClick={() => handleEnterDirectory(entry)}
                        onContextMenu={(e) => handleFolderContextMenu(e, entry.name)}
                      >
                        <span className="file-name">
                          <span className="badge folder">{t('app.folderBadge')}</span>
                          {entry.name}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={
                          selectedFile?.relativePath === entry.relativePath ? 'file active' : 'file'
                        }
                        onClick={() => handleSelectFile(entry)}
                      >
                        <span className="file-name">{entry.name}</span>
                        <span className="file-size">{formatBytes(entry.size ?? 0)}</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </aside>

            <main className="preview">
              <h2>{t('app.previewTitle')}</h2>
              <div className="preview-scroll">
                {readLoading && <p className="muted">{t('app.readingFile')}</p>}
                {selectedFile && !readLoading && isLogFileName(selectedFile.name) ? (
                  <LogHighlightedPre text={content} rules={logColorRules} />
                ) : selectedFile && !readLoading ? (
                  <pre className="content">{content}</pre>
                ) : null}
                {!selectedFile && !readLoading && (
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
