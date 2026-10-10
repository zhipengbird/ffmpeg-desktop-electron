/// <reference types="vite/client" />

interface ProgressEvent {
  jobId: string
  percent: number
  timemark?: string
}

interface ElectronAPI {
  openFiles: (filters?: { name: string; extensions: string[] }[]) => Promise<string[]>
  saveFile: (defaultName: string, filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
  openPath: (targetPath: string) => Promise<boolean>
  showItem: (targetPath: string) => Promise<boolean>
  exists: (p: string) => Promise<boolean>
  stat: (p: string) => Promise<{ size: number; isFile: boolean; mtime: number } | null>
  probe: (filePath: string) => Promise<Record<string, unknown>>
  imageInfo: (filePath: string) => Promise<Record<string, unknown>>
  cancelJob: (jobId: string) => Promise<boolean>
  compress: (opts: Record<string, unknown>) => Promise<{ ok: boolean; output?: string; error?: string }>
  convert: (opts: Record<string, unknown>) => Promise<{ ok: boolean; output?: string; error?: string }>
  separate: (opts: Record<string, unknown>) => Promise<{ ok: boolean; output?: string; error?: string }>
  trim: (opts: Record<string, unknown>) => Promise<{ ok: boolean; output?: string; error?: string }>
  compressImage: (opts: Record<string, unknown>) => Promise<{ ok: boolean; output?: string; error?: string }>
  defaultOutput: (input: string, suffix: string, ext?: string) => Promise<string>
  onProgress: (callback: (event: ProgressEvent) => void) => () => void
}

interface Window {
  api: ElectronAPI
}
