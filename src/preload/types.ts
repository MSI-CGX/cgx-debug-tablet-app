export interface FolderFile {
  name: string
  relativePath: string
  size: number
}

export interface AppAPI {
  openFolder: () => Promise<string | null>
  listFiles: (folderPath: string) => Promise<FolderFile[]>
  readFileText: (folderPath: string, relativePath: string) => Promise<string>
}
