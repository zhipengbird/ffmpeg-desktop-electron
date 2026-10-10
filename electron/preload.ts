import { contextBridge, ipcRenderer } from 'electron'

export interface ProgressEvent {
  jobId: string
  percent: number
  timemark?: string
}

const api = {
  openFiles: (filters?: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('dialog:openFiles', filters),
  saveFile: (defaultName: string, filters?: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('dialog:saveFile', defaultName, filters),
  openPath: (targetPath: string) => ipcRenderer.invoke('shell:openPath', targetPath),
  showItem: (targetPath: string) => ipcRenderer.invoke('shell:showItem', targetPath),
  exists: (p: string) => ipcRenderer.invoke('fs:exists', p) as Promise<boolean>,
  stat: (p: string) => ipcRenderer.invoke('fs:stat', p) as Promise<{ size: number; isFile: boolean; mtime: number } | null>,
  probe: (filePath: string) => ipcRenderer.invoke('media:probe', filePath),
  imageInfo: (filePath: string) => ipcRenderer.invoke('image:info', filePath),
  cancelJob: (jobId: string) => ipcRenderer.invoke('job:cancel', jobId),
  compress: (opts: Record<string, unknown>) => ipcRenderer.invoke('media:compress', opts),
  convert: (opts: Record<string, unknown>) => ipcRenderer.invoke('media:convert', opts),
  separate: (opts: Record<string, unknown>) => ipcRenderer.invoke('media:separate', opts),
  trim: (opts: Record<string, unknown>) => ipcRenderer.invoke('media:trim', opts),
  compressImage: (opts: Record<string, unknown>) => ipcRenderer.invoke('image:compress', opts),
  defaultOutput: (input: string, suffix: string, ext?: string) =>
    ipcRenderer.invoke('util:defaultOutput', input, suffix, ext),
  onProgress: (callback: (event: ProgressEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: ProgressEvent) => callback(data)
    ipcRenderer.on('job:progress', handler)
    return () => ipcRenderer.removeListener('job:progress', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
