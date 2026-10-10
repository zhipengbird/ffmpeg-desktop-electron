import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import {
  initFfmpegPaths,
  probeMedia,
  compressMedia,
  convertFormat,
  separateStreams,
  trimMedia,
  cancelJob,
  cancelAllJobs,
  defaultOutputPath,
  type CompressPreset,
  type MediaInfo
} from './ffmpeg'
import { compressImage, getImageInfo, type ImagePreset } from './image'

process.env.DIST_ELECTRON = path.join(__dirname)
process.env.DIST = path.join(__dirname, '../dist-renderer')
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(__dirname, '../public')
  : process.env.DIST

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: '媒体工具箱',
    backgroundColor: '#0f1117',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function sendProgress(jobId: string, percent: number, timemark?: string): void {
  mainWindow?.webContents.send('job:progress', { jobId, percent, timemark })
}

app.whenReady().then(() => {
  initFfmpegPaths()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  cancelAllJobs()
  if (process.platform !== 'darwin') app.quit()
})

// --- IPC ---

ipcMain.handle('dialog:openFiles', async (_e, filters?: Electron.FileFilter[]) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections'],
    filters: filters || [
      { name: '媒体文件', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'mp3', 'aac', 'wav', 'flac', 'm4a', 'ogg', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }
    ]
  })
  return result.canceled ? [] : result.filePaths
})

ipcMain.handle('dialog:saveFile', async (_e, defaultName: string, filters?: Electron.FileFilter[]) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: defaultName,
    filters: filters || [{ name: '所有文件', extensions: ['*'] }]
  })
  return result.canceled ? null : result.filePath
})

ipcMain.handle('shell:openPath', async (_e, targetPath: string) => {
  if (!targetPath || !fs.existsSync(targetPath)) return false
  const dir = fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath)
  await shell.openPath(dir)
  return true
})

ipcMain.handle('shell:showItem', async (_e, targetPath: string) => {
  if (!targetPath || !fs.existsSync(targetPath)) return false
  shell.showItemInFolder(targetPath)
  return true
})

ipcMain.handle('fs:exists', async (_e, p: string) => fs.existsSync(p))

ipcMain.handle('fs:stat', async (_e, p: string) => {
  try {
    const s = fs.statSync(p)
    return { size: s.size, isFile: s.isFile(), mtime: s.mtimeMs }
  } catch {
    return null
  }
})

ipcMain.handle('media:probe', async (_e, filePath: string): Promise<MediaInfo | { error: string }> => {
  try {
    return await probeMedia(filePath)
  } catch (err) {
    return { error: (err as Error).message }
  }
})

ipcMain.handle('image:info', async (_e, filePath: string) => {
  try {
    return await getImageInfo(filePath)
  } catch (err) {
    return { error: (err as Error).message }
  }
})

ipcMain.handle('job:cancel', async (_e, jobId: string) => cancelJob(jobId))

ipcMain.handle('media:compress', async (_e, opts: {
  jobId: string
  input: string
  output?: string
  preset: CompressPreset
  customCrf?: number
  customBitrate?: string
  isAudioOnly?: boolean
}) => {
  try {
    const output = opts.output || defaultOutputPath(
      opts.input,
      `压缩_${opts.preset}`,
      opts.isAudioOnly ? path.extname(opts.input) : '.mp4'
    )
    const result = await compressMedia({
      ...opts,
      output,
      onProgress: (percent, timemark) => sendProgress(opts.jobId, percent, timemark)
    })
    return { ok: true, output: result }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('media:convert', async (_e, opts: {
  jobId: string
  input: string
  output?: string
  format: string
}) => {
  try {
    const ext = `.${opts.format}`
    const output = opts.output || defaultOutputPath(opts.input, '转换', ext)
    const result = await convertFormat({
      ...opts,
      output,
      onProgress: (percent, timemark) => sendProgress(opts.jobId, percent, timemark)
    })
    return { ok: true, output: result }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('media:separate', async (_e, opts: {
  jobId: string
  input: string
  output?: string
  mode: 'audio' | 'video'
}) => {
  try {
    const ext = opts.mode === 'audio' ? '.mp3' : '.mp4'
    const suffix = opts.mode === 'audio' ? '音频' : '无声视频'
    const output = opts.output || defaultOutputPath(opts.input, suffix, ext)
    const result = await separateStreams({
      ...opts,
      output,
      onProgress: (percent, timemark) => sendProgress(opts.jobId, percent, timemark)
    })
    return { ok: true, output: result }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('media:trim', async (_e, opts: {
  jobId: string
  input: string
  output?: string
  start: number
  end: number
}) => {
  try {
    const output = opts.output || defaultOutputPath(opts.input, '截取')
    const result = await trimMedia({
      ...opts,
      output,
      onProgress: (percent, timemark) => sendProgress(opts.jobId, percent, timemark)
    })
    return { ok: true, output: result }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('image:compress', async (_e, opts: {
  jobId: string
  input: string
  output?: string
  preset: ImagePreset
  customQuality?: number
  format?: 'jpeg' | 'png' | 'webp'
}) => {
  try {
    const format = opts.format || (path.extname(opts.input).slice(1).toLowerCase() as 'jpeg' | 'png' | 'webp')
    const normFormat = (format as string) === 'jpg' ? 'jpeg' : format
    const ext = normFormat === 'jpeg' ? '.jpg' : `.${normFormat}`
    const output = opts.output || defaultOutputPath(opts.input, `压缩_${opts.preset}`, ext)
    sendProgress(opts.jobId, 10)
    const result = await compressImage({
      input: opts.input,
      output,
      preset: opts.preset,
      customQuality: opts.customQuality,
      format: normFormat as 'jpeg' | 'png' | 'webp'
    })
    sendProgress(opts.jobId, 100)
    return { ok: true, output: result }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('util:defaultOutput', (_e, input: string, suffix: string, ext?: string) => {
  return defaultOutputPath(input, suffix, ext)
})
