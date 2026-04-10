import { useCallback, useState } from 'react'
import type { FolderFile } from '../../preload/types'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function App(): JSX.Element {
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [files, setFiles] = useState<FolderFile[]>([])
  const [selected, setSelected] = useState<FolderFile | null>(null)
  const [content, setContent] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [readLoading, setReadLoading] = useState(false)

  const loadFolder = useCallback(async (path: string) => {
    setError(null)
    setListLoading(true)
    setSelected(null)
    setContent('')
    try {
      const list = await window.api.listFiles(path)
      setFiles(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setFiles([])
    } finally {
      setListLoading(false)
    }
  }, [])

  const handleOpenFolder = async (): Promise<void> => {
    setError(null)
    const path = await window.api.openFolder()
    if (!path) return
    setFolderPath(path)
    await loadFolder(path)
  }

  const handleSelectFile = async (file: FolderFile): Promise<void> => {
    if (!folderPath) return
    setSelected(file)
    setError(null)
    setReadLoading(true)
    setContent('')
    try {
      const text = await window.api.readFileText(folderPath, file.relativePath)
      setContent(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReadLoading(false)
    }
  }

  return (
    <div className="layout">
      <header className="header">
        <h1>Folder reader</h1>
        <button type="button" className="btn primary" onClick={handleOpenFolder}>
          Open folder
        </button>
      </header>

      {folderPath && (
        <p className="path" title={folderPath}>
          {folderPath}
        </p>
      )}

      {error && <div className="banner error">{error}</div>}

      <div className="panels">
        <aside className="sidebar">
          <h2>Files</h2>
          {!folderPath && <p className="muted">Choose a folder to list files.</p>}
          {folderPath && listLoading && <p className="muted">Loading…</p>}
          {folderPath && !listLoading && files.length === 0 && (
            <p className="muted">No files in this folder.</p>
          )}
          <ul className="file-list">
            {files.map((f) => (
              <li key={f.relativePath}>
                <button
                  type="button"
                  className={selected?.relativePath === f.relativePath ? 'file active' : 'file'}
                  onClick={() => handleSelectFile(f)}
                >
                  <span className="file-name">{f.name}</span>
                  <span className="file-size">{formatBytes(f.size)}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="preview">
          <h2>Content</h2>
          {readLoading && <p className="muted">Reading file…</p>}
          {selected && !readLoading && <pre className="content">{content}</pre>}
          {!selected && !readLoading && (
            <p className="muted">Select a file to read its text content.</p>
          )}
        </main>
      </div>
    </div>
  )
}
