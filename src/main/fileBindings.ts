import path from 'path'
import type { ExtensionPreviewKind, FileReadMode } from './appStore'
import { getDefaultExtensionPreviewMap } from './appStore'

/** Key for persisted bindings: path relative to workspace root, forward slashes. */
export function fileBindingKey(relativePath: string): string {
  return relativePath.replace(/\\/g, '/')
}

function mergeExtensionMaps(
  stored: Record<string, ExtensionPreviewKind>
): Record<string, ExtensionPreviewKind> {
  return { ...getDefaultExtensionPreviewMap(), ...stored }
}

/**
 * Resolves preview mode: per-path binding wins, then extension map for files.
 */
export function resolvePreviewReadMode(
  pathBindings: Record<string, Exclude<FileReadMode, 'plain'>>,
  extensionMap: Record<string, ExtensionPreviewKind>,
  relativePath: string,
  kind: 'file' | 'directory',
  fileName: string
): FileReadMode {
  const key = fileBindingKey(relativePath)
  const bound = pathBindings[key]
  if (bound !== undefined) {
    return bound
  }
  if (kind === 'directory') {
    return 'plain'
  }
  if (/^iot_timeline\.lmdb$/i.test(fileName)) {
    return 'lmdb'
  }
  const ext = path.extname(fileName).replace(/^\./, '').toLowerCase()
  const merged = mergeExtensionMaps(extensionMap)
  if (ext && merged[ext] === 'image') {
    return 'image'
  }
  return 'plain'
}
