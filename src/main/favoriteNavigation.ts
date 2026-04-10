import path from 'path'
import { stat } from 'fs/promises'
import { resolveUnderWorkspace } from './workspacePaths'

export type FavoriteOpenResult =
  | {
      ok: true
      rootPath: string
      relativeDir: string
      /** Full path relative to workspace root (matches list entries), or null */
      selectRelativePath: string | null
    }
  | { ok: false; error: string }

/**
 * Opens a favorite path (relative to workspace root) using the workspace folder as explorer root.
 */
export async function resolveFavoriteFromWorkspaceRel(
  workspaceRoot: string,
  relativeFavorite: string
): Promise<FavoriteOpenResult> {
  const root = path.normalize(path.resolve(workspaceRoot))
  const full = resolveUnderWorkspace(workspaceRoot, relativeFavorite)
  const relFromRoot = path.relative(root, full)
  if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) {
    return { ok: false, error: 'Outside workspace' }
  }
  try {
    const st = await stat(full)
    if (st.isDirectory()) {
      const relNorm = relFromRoot.replace(/\\/g, path.sep)
      return {
        ok: true,
        rootPath: root,
        relativeDir: relNorm,
        selectRelativePath: null
      }
    }
    if (st.isFile()) {
      const dirRel = path.dirname(relFromRoot)
      const relativeDir =
        dirRel === '.' || dirRel === '' ? '' : dirRel.replace(/\\/g, path.sep)
      const selectRel = relFromRoot.replace(/\\/g, path.sep)
      return {
        ok: true,
        rootPath: root,
        relativeDir,
        selectRelativePath: selectRel
      }
    }
    return { ok: false, error: 'Not a file or directory' }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}
