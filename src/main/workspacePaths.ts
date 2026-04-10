import path from 'path'

/** Normalize relative path for storage (forward slashes, no leading slash). */
export function normalizeStoredRel(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * True when `absolute` is under `workspaceRoot` (resolved, case-sensitive on non-Win).
 */
export function isUnderWorkspace(workspaceRoot: string, absolute: string): boolean {
  const root = path.normalize(path.resolve(workspaceRoot))
  const full = path.normalize(path.resolve(absolute))
  const rel = path.relative(root, full)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Relative path from workspace root to absolute path, or null if outside. */
export function toWorkspaceRelative(
  workspaceRoot: string,
  absolute: string
): string | null {
  const root = path.normalize(path.resolve(workspaceRoot))
  const full = path.normalize(path.resolve(absolute))
  const rel = path.relative(root, full)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return normalizeStoredRel(rel)
}

/** Join workspace root with stored relative path (slashes in store → native). */
export function resolveUnderWorkspace(workspaceRoot: string, storedRel: string): string {
  const root = path.normalize(path.resolve(workspaceRoot))
  const parts = normalizeStoredRel(storedRel).split('/').filter(Boolean)
  return path.normalize(path.join(root, ...parts))
}
