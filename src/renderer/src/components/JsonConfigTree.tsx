import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  isPathExcludedByRules,
  pathSegmentsToDottedKey
} from '../../../common/configExcludedPaths'

type Path = (string | number)[]

type Props = {
  data: unknown
  /** Exclusion rules from Settings (exact paths or patterns with `*`, e.g. users.*.password). */
  excludedPathRules: readonly string[]
  /** Persist this path via Settings (optional). */
  onAddExcludedPath?: (dottedPath: string) => void | Promise<void>
}

function serializePath(path: Path): string {
  return JSON.stringify(path)
}

/** Label for the last path segment (object key or [index] for arrays). */
function segmentLabel(path: Path): string {
  if (path.length === 0) return ''
  const last = path[path.length - 1]!
  return typeof last === 'number' ? `[${last}]` : last
}

function canOpenContextMenuForPath(path: Path): boolean {
  return path.length > 0
}

/**
 * Read-only hierarchical view of JSON for workspace config preview (form-like rows + nested details).
 * Paths listed in Settings are omitted from rendering only. Context menu can add a path to that list.
 */
export default function JsonConfigTree({
  data,
  excludedPathRules,
  onAddExcludedPath
}: Props): JSX.Element {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<{
    x: number
    y: number
    path: Path
  } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const openContextMenu = useCallback((e: React.MouseEvent, path: Path): void => {
    if (!canOpenContextMenuForPath(path)) return
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, path })
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent): void => {
      const el = e.target as Node
      if (menuRef.current?.contains(el)) return
      setMenu(null)
    }
    document.addEventListener('mousedown', close, true)
    return (): void => document.removeEventListener('mousedown', close, true)
  }, [menu])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('keydown', onKey)
    return (): void => document.removeEventListener('keydown', onKey)
  }, [menu])

  const dottedForMenu = menu ? pathSegmentsToDottedKey(menu.path) : ''
  const alreadyExcluded =
    menu !== null &&
    dottedForMenu !== '' &&
    isPathExcludedByRules(menu.path, excludedPathRules)

  const handleAddExcluded = async (): Promise<void> => {
    if (!menu || !onAddExcludedPath || alreadyExcluded || !dottedForMenu) return
    await onAddExcludedPath(dottedForMenu)
    setMenu(null)
  }

  const handleCopyPath = async (): Promise<void> => {
    if (!menu || !dottedForMenu) return
    try {
      await navigator.clipboard.writeText(dottedForMenu)
    } catch {
      /* ignore */
    }
    setMenu(null)
  }

  return (
    <>
      <div className="json-config-tree">
        {renderNode(data, [], 0, {
          t,
          excludedPathRules,
          openContextMenu
        })}
      </div>
      {menu && dottedForMenu ? (
        <div
          ref={menuRef}
          className="json-config-context-menu"
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            zIndex: 10000
          }}
          role="menu"
        >
          {onAddExcludedPath ? (
            <button
              type="button"
              className="json-config-context-menu-item"
              role="menuitem"
              disabled={alreadyExcluded}
              title={alreadyExcluded ? t('app.configTreeContextAlreadyExcluded') : undefined}
              onClick={() => void handleAddExcluded()}
            >
              {alreadyExcluded
                ? t('app.configTreeContextAlreadyExcluded')
                : t('app.configTreeContextAddExcluded')}
            </button>
          ) : null}
          <button
            type="button"
            className="json-config-context-menu-item"
            role="menuitem"
            onClick={() => void handleCopyPath()}
          >
            {t('app.configTreeContextCopyPath')}
          </button>
        </div>
      ) : null}
    </>
  )
}

type RenderCtx = {
  t: (k: string, opts?: Record<string, unknown>) => string
  excludedPathRules: readonly string[]
  openContextMenu: (e: React.MouseEvent, path: Path) => void
}

function renderNode(
  value: unknown,
  path: Path,
  depth: number,
  ctx: RenderCtx
): ReactNode {
  const { t, excludedPathRules, openContextMenu } = ctx
  if (isPathExcludedByRules(path, excludedPathRules)) {
    return null
  }

  const pad = Math.min(depth, 12) * 12
  const name = segmentLabel(path)
  const rowContext = canOpenContextMenuForPath(path)
    ? (e: React.MouseEvent) => openContextMenu(e, path)
    : undefined
  const summaryContext = canOpenContextMenuForPath(path)
    ? (e: React.MouseEvent) => openContextMenu(e, path)
    : undefined

  if (value === null || value === undefined) {
    return (
      <div
        className={`json-config-row${rowContext ? ' json-config-row-context' : ''}`}
        style={{ paddingLeft: pad }}
        key={serializePath(path)}
        onContextMenu={rowContext}
      >
        {name !== '' ? <span className="json-config-key">{name}</span> : null}
        <code className="json-config-primitive">
          {value === null ? 'null' : 'undefined'}
        </code>
      </div>
    )
  }
  const tName = typeof value
  if (tName !== 'object') {
    const display = tName === 'string' ? (value as string) : String(value)
    return (
      <div
        className={`json-config-row${rowContext ? ' json-config-row-context' : ''}`}
        style={{ paddingLeft: pad }}
        key={serializePath(path)}
        onContextMenu={rowContext}
      >
        {name !== '' ? (
          <label className="json-config-key">{name}</label>
        ) : null}
        <input
          type="text"
          readOnly
          className="json-config-input"
          value={display}
          aria-readonly
          tabIndex={-1}
        />
      </div>
    )
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div
          className={`json-config-row${rowContext ? ' json-config-row-context' : ''}`}
          style={{ paddingLeft: pad }}
          key={serializePath(path)}
          onContextMenu={rowContext}
        >
          {name !== '' ? <span className="json-config-key">{name}</span> : null}
          <span className="json-config-empty">[]</span>
        </div>
      )
    }
    const visibleIndices = Array.from({ length: value.length }, (_, i) => i).filter(
      (i) => !isPathExcludedByRules([...path, i], excludedPathRules)
    )
    if (visibleIndices.length === 0) {
      return (
        <details
          open={depth < 4}
          className="json-config-details"
          style={{ paddingLeft: pad }}
          key={`${serializePath(path)}-arr-all-excl`}
        >
          <summary
            className={`json-config-summary${summaryContext ? ' json-config-summary-context' : ''}`}
            onContextMenu={summaryContext}
          >
            {name !== '' ? `${name} · ` : ''}
            {t('app.configTreeArray')} (0)
          </summary>
          <p className="muted small json-config-excluded-hint">
            {t('app.configTreePathsExcluded')}
          </p>
        </details>
      )
    }
    return (
      <details
        open={depth < 4}
        className="json-config-details"
        style={{ paddingLeft: pad }}
        key={`${serializePath(path)}-arrd`}
      >
        <summary
          className={`json-config-summary${summaryContext ? ' json-config-summary-context' : ''}`}
          onContextMenu={summaryContext}
        >
          {name !== '' ? `${name} · ` : ''}
          {t('app.configTreeArray')} ({visibleIndices.length})
        </summary>
        <div className="json-config-children">
          {visibleIndices.map((i) => {
            const childPath = [...path, i]
            return (
              <Fragment key={serializePath(childPath)}>
                {renderNode(value[i], childPath, depth + 1, ctx)}
              </Fragment>
            )
          })}
        </div>
      </details>
    )
  }
  const obj = value as Record<string, unknown>
  const allKeys = Object.keys(obj).sort((a, b) => a.localeCompare(b))
  const keys = allKeys.filter(
    (k) => !isPathExcludedByRules([...path, k], excludedPathRules)
  )
  if (allKeys.length === 0) {
    return (
      <div
        className={`json-config-row${rowContext ? ' json-config-row-context' : ''}`}
        style={{ paddingLeft: pad }}
        key={serializePath(path)}
        onContextMenu={rowContext}
      >
        {name !== '' ? <span className="json-config-key">{name}</span> : null}
        <span className="json-config-empty">{'{}'}</span>
      </div>
    )
  }
  if (keys.length === 0) {
    return (
      <details
        open={depth < 3}
        className="json-config-details"
        style={{ paddingLeft: pad }}
        key={`${serializePath(path)}-obj-all-excl`}
      >
        <summary
          className={`json-config-summary${summaryContext ? ' json-config-summary-context' : ''}`}
          onContextMenu={summaryContext}
        >
          {name !== '' ? `${name} · ` : ''}
          {t('app.configTreeObject')} (0)
        </summary>
        <p className="muted small json-config-excluded-hint">
          {t('app.configTreePathsExcluded')}
        </p>
      </details>
    )
  }
  return (
    <details
      open={depth < 3}
      className="json-config-details"
      style={{ paddingLeft: pad }}
      key={`${serializePath(path)}-obj`}
    >
      <summary
        className={`json-config-summary${summaryContext ? ' json-config-summary-context' : ''}`}
        onContextMenu={summaryContext}
      >
        {name !== '' ? `${name} · ` : ''}
        {t('app.configTreeObject')} ({keys.length})
      </summary>
      <div className="json-config-children">
        {keys.map((k) => {
          const childPath = [...path, k]
          return (
            <Fragment key={serializePath(childPath)}>
              {renderNode(obj[k], childPath, depth + 1, ctx)}
            </Fragment>
          )
        })}
      </div>
    </details>
  )
}
