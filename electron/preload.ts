import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  EncoderInfo, JobResult, ProgressEvent, QueueKind, QueueSnapshot, Settings
} from '../shared/types'

type Filters = { name: string; extensions: string[] }[]

function listen<T>(channel: string, cb: (data: T) => void): () => void {
  const handler = (_: Electron.IpcRendererEvent, data: T) => cb(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  platform: process.platform as string,
  openFiles: (filters?: Filters, multi = true) => ipcRenderer.invoke('dialog:openFiles', filters, multi) as Promise<string[]>,
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory') as Promise<string | null>,
  /** 拖放的 File → 本地路径（Electron 32+ 不再提供 File.path） */
  pathForFile: (file: File): string => {
    try { return webUtils.getPathForFile(file) } catch { return '' }
  },
  openFile: (p: string) => ipcRenderer.invoke('shell:openFile', p) as Promise<boolean>,
  openPath: (p: string) => ipcRenderer.invoke('shell:openPath', p) as Promise<boolean>,
  showItem: (p: string) => ipcRenderer.invoke('shell:showItem', p) as Promise<boolean>,
  startDrag: (p: string) => ipcRenderer.send('shell:startDrag', p),
  stat: (p: string) => ipcRenderer.invoke('fs:stat', p) as Promise<{ size: number; isFile: boolean; mtime: number } | null>,
  probe: (p: string) => ipcRenderer.invoke('media:probe', p) as Promise<Record<string, unknown>>,
  imageInfo: (p: string) => ipcRenderer.invoke('image:info', p) as Promise<Record<string, unknown>>,
  allowMedia: (p: string) => ipcRenderer.invoke('media:allow', p) as Promise<string | null>,
  cancelJob: (jobId: string) => ipcRenderer.invoke('job:cancel', jobId) as Promise<boolean>,
  trim: (opts: { jobId: string; input: string; start: number; end: number; mode: 'fast' | 'precise'; normalizeAudio?: boolean }) =>
    ipcRenderer.invoke('media:trim', opts) as Promise<JobResult>,
  merge: (opts: { jobId: string; inputs: string[]; mode?: 'auto' | 'copy' | 'transcode'; normalizeAudio?: boolean }) =>
    ipcRenderer.invoke('media:merge', opts) as Promise<JobResult>,
  compareFrames: (opts: { original: string; processed: string; timestamp?: number }) =>
    ipcRenderer.invoke('media:compareFrames', opts) as Promise<{ originalThumb: string; processedThumb: string }>,
  onProgress: (cb: (e: ProgressEvent) => void) => listen<ProgressEvent>('job:progress', cb),

  queue: {
    snapshot: (kind: QueueKind) => ipcRenderer.invoke('queue:snapshot', kind) as Promise<QueueSnapshot>,
    add: (kind: QueueKind, paths: string[]) => ipcRenderer.invoke('queue:add', kind, paths) as Promise<QueueSnapshot>,
    start: (kind: QueueKind, params: Record<string, unknown>) => ipcRenderer.invoke('queue:start', kind, params) as Promise<boolean>,
    cancel: (kind: QueueKind, id: string) => ipcRenderer.invoke('queue:cancel', kind, id) as Promise<boolean>,
    cancelAll: (kind: QueueKind) => ipcRenderer.invoke('queue:cancelAll', kind) as Promise<boolean>,
    remove: (kind: QueueKind, id: string) => ipcRenderer.invoke('queue:remove', kind, id) as Promise<boolean>,
    retry: (kind: QueueKind, id: string) => ipcRenderer.invoke('queue:retry', kind, id) as Promise<boolean>,
    clearFinished: (kind: QueueKind) => ipcRenderer.invoke('queue:clearFinished', kind) as Promise<number>,
    clearAll: (kind: QueueKind) => ipcRenderer.invoke('queue:clearAll', kind) as Promise<boolean>,
    onChanged: (cb: (s: QueueSnapshot) => void) => listen<QueueSnapshot>('queue:changed', cb),
    onProgress: (cb: (e: { kind: QueueKind; id: string; percent: number | null; timemark?: string }) => void) =>
      listen<{ kind: QueueKind; id: string; percent: number | null; timemark?: string }>('queue:progress', cb)
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
    set: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch) as Promise<Settings>,
    reset: () => ipcRenderer.invoke('settings:reset') as Promise<Settings>,
    path: () => ipcRenderer.invoke('settings:path') as Promise<string>,
    onChanged: (cb: (s: Settings) => void) => listen<Settings>('settings:changed', cb)
  },

  hw: {
    get: () => ipcRenderer.invoke('hw:get') as Promise<EncoderInfo>,
    redetect: () => ipcRenderer.invoke('hw:redetect') as Promise<EncoderInfo>,
    onInfo: (cb: (i: EncoderInfo) => void) => listen<EncoderInfo>('hw:info', cb)
  },

  appInfo: () => ipcRenderer.invoke('app:info') as Promise<{ version: string; platform: string; arch: string }>
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
