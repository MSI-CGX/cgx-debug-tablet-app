import path from 'path'
import type { FileReadMode } from './appStore'

export function fileBindingKey(rootFolderPath: string, relativePath: string): string {
  const root = path.resolve(rootFolderPath)
  const rel = relativePath.replace(/\\/g, '/')
  return `${root}|${rel}`
}

export function getFileReadMode(
  bindings: Record<string, FileReadMode>,
  rootFolderPath: string,
  relativePath: string
): FileReadMode {
  const key = fileBindingKey(rootFolderPath, relativePath)
  return bindings[key] ?? 'plain'
}
