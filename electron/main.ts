import { app, BrowserWindow, ipcMain, dialog, shell, protocol, Notification, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import { Readable } from 'stream'
import { initFfmpegPaths } from './ffmpeg'
import { ImageEngine } from './image-engine'
import {
  TaskQueue, SettingsStore, PathReservations, detectHwEncoders, cancelJob, cancelAllJobs,
  setGlobalQuietMode, sanitizeSettings,
  probeMedia, mapError, JobFailedError, parseRange, mimeFor, mediaUrlToPath, pathToMediaUrl,
  compressTask, convertTask, separateTask, imageTask, trimTask, mergeTask, extractFrame,
  generateContactSheet, extractAudioWaveform, detectSilence, jumpCutMedia, reframeToVertical,
  type TaskEnv, type TaskWorker, type TrimParams, type MergeParams, type JumpCutParams, type ReframeParams
} from './core'
import {
  summarizeItems, type EncoderInfo, type JobResult, type QueueItem, type QueueKind, type Settings
} from '../shared/types'
import { formatSize, formatChange } from '../shared/format'

process.env.DIST_ELECTRON = path.join(__dirname)
process.env.DIST = path.join(__dirname, '../dist-renderer')
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(__dirname, '../public')
  : process.env.DIST

// 必须在 app ready 之前注册：media:// 用于本地音视频预览（支持 Range / 拖动进度 / CORS）
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } }
])

let mainWindow: BrowserWindow | null = null
let settingsStore: SettingsStore
let encoderInfo: EncoderInfo = { ready: false, platform: process.platform, listed: [], tested: [], preferred: null }
const reservations = new PathReservations()
let imageEngine: ImageEngine
/** 允许通过 media:// 预览的文件（最多保留最近 100 个文件，LRU 淘汰） */
const MAX_ALLOWED_MEDIA = 100
const allowedMedia = new Set<string>()

function normPath(p: string): string {
  let target = p
  try {
    if (fs.existsSync(p)) target = fs.realpathSync(p)
  } catch { /* ignore */ }
  const r = path.resolve(target)
  return process.platform === 'win32' || process.platform === 'darwin' ? r.toLowerCase() : r
}

function allowMedia(filePath: string): void {
  const norm = normPath(filePath)
  if (allowedMedia.has(norm)) {
    allowedMedia.delete(norm)
    allowedMedia.add(norm)
    return
  }
  if (allowedMedia.size >= MAX_ALLOWED_MEDIA) {
    const oldest = allowedMedia.values().next().value
    if (oldest) allowedMedia.delete(oldest)
  }
  allowedMedia.add(norm)
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 640,
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

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  // 拖放文件到窗口时不跳转页面；禁止打开新窗口
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!process.env.VITE_DEV_SERVER_URL || !url.startsWith(process.env.VITE_DEV_SERVER_URL)) e.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

// ---------- 通知 / 完成后操作 ----------

function notify(title: string, body: string, revealPath?: string): void {
  if (!settingsStore.get().notifyOnFinish) return
  try {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body, silent: false })
    if (revealPath) n.on('click', () => { if (fs.existsSync(revealPath)) shell.showItemInFolder(revealPath) })
    n.show()
  } catch (e) {
    console.warn('[notify] 失败', e)
  }
}

function afterFinish(output: string | undefined): void {
  if (!output || !settingsStore.get().openFolderOnFinish) return
  if (fs.existsSync(output)) shell.showItemInFolder(output)
}

const KIND_LABEL: Record<QueueKind, string> = {
  compress: '音视频压缩', image: '图片压缩', separate: '音视频分离', convert: '格式转换'
}

function onBatchDrain(kind: QueueKind, items: QueueItem[]): void {
  const s = summarizeItems(items)
  if (s.done + s.failed + s.skipped === 0) return // 全部被用户取消：不打扰
  const firstOut = items.find((i) => i.status === 'done')?.output
  const parts = [`成功 ${s.done}`]
  if (s.failed) parts.push(`失败 ${s.failed}`)
  if (s.skipped) parts.push(`跳过 ${s.skipped}`)
  if (s.cancelled) parts.push(`取消 ${s.cancelled}`)
  if (s.done && s.inputBytes) {
    parts.push(s.savedBytes >= 0 ? `共节省 ${formatSize(s.savedBytes)}` : `共增加 ${formatSize(-s.savedBytes)}`)
  }
  let title: string
  if (items.length === 1) {
    const it = items[0]
    title = it.status === 'done' ? `${KIND_LABEL[kind]}完成` : it.status === 'failed' ? `${KIND_LABEL[kind]}失败` : `${KIND_LABEL[kind]}已结束`
    const name = path.basename(it.output || it.input)
    const body = it.status === 'done'
      ? `${name}  ${formatSize(it.inputSize)} → ${formatSize(it.outputSize ?? 0)}，${formatChange(it.inputSize, it.outputSize ?? 0)}`
      : `${name}：${it.error?.message || it.notice || ''}`
    notify(title, body, it.output)
  } else {
    title = s.failed === 0 ? `批量${KIND_LABEL[kind]}完成` : s.done === 0 ? `批量${KIND_LABEL[kind]}失败` : `批量${KIND_LABEL[kind]}完成（部分失败）`
    notify(title, parts.join(' · '), firstOut)
  }
  afterFinish(firstOut)
}

// ---------- 队列 ----------

const env: TaskEnv = {
  getSettings: () => settingsStore.get(),
  getEncoderInfo: () => encoderInfo,
  reservations,
  compressImage: (opts) => imageEngine.compress(opts)
}

const queues = new Map<QueueKind, TaskQueue<any>>()
// 单文件任务（裁剪）
const singleJobs = new Map<string, AbortController>()
const singleJobProgress = new Map<string, number>()

function updateAppProgressBar(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  let anyError = false
  let completed = 0
  let total = 0
  let runningProgress = 0

  for (const [, q] of queues) {
    const s = q.snapshot()
    for (const it of s.items) {
      total++
      if (it.status === 'done' || it.status === 'skipped') {
        completed++
      } else if (it.status === 'failed') {
        completed++
        anyError = true
      } else if (it.status === 'running') {
        runningProgress += Math.max(0, (it.percent ?? 0) / 100)
      }
    }
  }

  // 纯单任务场景（如无批量队列，只有单个剪辑任务）
  if (total === 0) {
    if (singleJobs.size === 0) {
      mainWindow.setProgressBar(-1)
      return
    }
    let sum = 0
    for (const p of singleJobProgress.values()) sum += p
    const avg = singleJobProgress.size > 0 ? (sum / singleJobProgress.size) / 100 : 0.01
    const ratio = Math.min(0.99, Math.max(0.01, avg))
    mainWindow.setProgressBar(ratio)
    return
  }

  // 批量任务场景（可同时混合单任务）
  let singleSum = 0
  for (const p of singleJobProgress.values()) singleSum += p / 100
  const grandTotal = total + singleJobs.size
  const grandCompleted = completed + runningProgress + singleSum

  if (grandCompleted <= 0 && singleJobs.size === 0 && completed === 0) {
    mainWindow.setProgressBar(-1)
    return
  }

  const ratio = Math.min(0.99, Math.max(0.01, grandCompleted / grandTotal))
  try {
    mainWindow.setProgressBar(ratio, { mode: anyError ? 'error' : 'normal' })
  } catch {
    mainWindow.setProgressBar(ratio)
  }
}

function makeQueue<P>(kind: QueueKind, worker: (item: QueueItem, p: P, ctx: Parameters<TaskWorker<P>>[2], env: TaskEnv) => ReturnType<TaskWorker<P>>): void {
  const s = settingsStore.get()
  const q = new TaskQueue<P>({
    kind,
    concurrency: kind === 'image' ? s.imageConcurrency : s.concurrency,
    worker: (item, p, ctx) => worker(item, p, ctx, env),
    onChange: (snap) => {
      send('queue:changed', snap)
      updateAppProgressBar()
    },
    onProgress: (k, id, percent, timemark) => {
      send('queue:progress', { kind: k, id, percent, timemark })
      updateAppProgressBar()
    },
    onDrain: (items) => {
      onBatchDrain(kind, items)
      updateAppProgressBar()
    },
    onCancelRunning: (item) => cancelJob(item.id),
    sizeOf: (p) => { try { return fs.statSync(p).size } catch { return 0 } }
  })
  queues.set(kind, q)
}

function getQueue(kind: QueueKind): TaskQueue<unknown> {
  const q = queues.get(kind)
  if (!q) throw new Error(`未知队列 ${kind}`)
  return q
}

function applySettings(s: Settings): void {
  for (const [kind, q] of queues) q.setConcurrency(kind === 'image' ? s.imageConcurrency : s.concurrency)
  setGlobalQuietMode(s.quietMode)
}

// ---------- media:// 协议 ----------

function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    const p = mediaUrlToPath(request.url)
    if (!p || !path.isAbsolute(p) || !allowedMedia.has(normPath(p))) {
      return new Response('Forbidden', { status: 403 })
    }
    let stat: fs.Stats
    try {
      stat = fs.statSync(p)
      if (!stat.isFile()) throw new Error('not file')
    } catch {
      return new Response('Not Found', { status: 404 })
    }
    const size = stat.size
    const type = mimeFor(path.extname(p))
    const range = parseRange(request.headers.get('range'), size)
    if (range === 'unsatisfiable') {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    const start = range ? range.start : 0
    const end = range ? range.end : size - 1
    const stream = Readable.toWeb(fs.createReadStream(p, { start, end })) as unknown as ReadableStream
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS'
    }
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    return new Response(stream, { status: range ? 206 : 200, headers })
  })
}

// ---------- 生命周期 ----------

app.whenReady().then(() => {
  initFfmpegPaths()
  imageEngine = new ImageEngine()
  void imageEngine.warmup()
  settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'))
  applySettings(settingsStore.get())
  makeQueue('compress', compressTask)
  makeQueue('convert', convertTask)
  makeQueue('separate', separateTask)
  makeQueue('image', imageTask)
  registerMediaProtocol()
  createWindow()

  // 启动后后台检测硬件编码器（无 GPU 时安全返回空结果）
  detectHwEncoders().then((info) => {
    encoderInfo = info
    console.log('[hwaccel]', JSON.stringify({ listed: info.listed, preferred: info.preferred, tested: info.tested.map((t) => `${t.name}:${t.ok}`) }))
    send('hw:info', info)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  for (const q of queues.values()) q.cancelAll()
  cancelAllJobs()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  cancelAllJobs()
  imageEngine?.dispose()
})

// ---------- IPC ----------

const MEDIA_EXTS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'm4v', 'wmv', 'mp3', 'aac', 'wav', 'flac', 'm4a', 'ogg', 'opus', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif']

ipcMain.handle('dialog:openFiles', async (_e, filters?: Electron.FileFilter[], multi = true) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: filters || [{ name: '媒体文件', extensions: MEDIA_EXTS }]
  })
  return result.canceled ? [] : result.filePaths
})

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('shell:openFile', async (_e, targetPath: string) => {
  if (!targetPath || !fs.existsSync(targetPath)) return false
  const err = await shell.openPath(targetPath)
  return !err
})

ipcMain.handle('shell:openPath', async (_e, targetPath: string) => {
  if (!targetPath || !fs.existsSync(targetPath)) return false
  const dir = fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath)
  return !(await shell.openPath(dir))
})

ipcMain.handle('shell:showItem', async (_e, targetPath: string) => {
  if (!targetPath || !fs.existsSync(targetPath)) return false
  shell.showItemInFolder(targetPath)
  return true
})

ipcMain.on('shell:startDrag', (event, targetPath: string) => {
  if (!targetPath || typeof targetPath !== 'string' || !fs.existsSync(targetPath)) return
  try {
    const iconCandidate = path.join(__dirname, '../resources/icon-512.png')
    const fallbackIcon = path.join(__dirname, '../resources/icon.png')
    let dragIcon: string | Electron.NativeImage
    if (fs.existsSync(iconCandidate)) {
      dragIcon = iconCandidate
    } else if (fs.existsSync(fallbackIcon)) {
      dragIcon = fallbackIcon
    } else {
      dragIcon = nativeImage.createEmpty()
    }
    event.sender.startDrag({
      file: targetPath,
      icon: dragIcon
    })
  } catch (err) {
    console.warn('[startDrag] 失败:', err)
  }
})

ipcMain.handle('fs:stat', async (_e, p: string) => {
  try {
    const s = fs.statSync(p)
    return { size: s.size, isFile: s.isFile(), mtime: s.mtimeMs }
  } catch {
    return null
  }
})

ipcMain.handle('media:probe', async (_e, filePath: string) => {
  try {
    return await probeMedia(filePath)
  } catch (err) {
    const job = err instanceof JobFailedError ? err.job : mapError(err)
    return { error: job.message, detail: job.detail }
  }
})

ipcMain.handle('image:info', async (_e, filePath: string) => {
  try {
    return await imageEngine.info(filePath)
  } catch (err) {
    const job = mapError(err)
    return { error: job.message, detail: job.detail }
  }
})

/** 允许预览某个本地文件，返回 media:// URL。 */
ipcMain.handle('media:allow', (_e, filePath: string) => {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return null
  try {
    if (!fs.statSync(filePath).isFile()) return null
  } catch {
    return null
  }
  allowMedia(filePath)
  return pathToMediaUrl(filePath)
})

// 单文件任务（裁剪）- 已提前声明 singleJobs 与 singleJobProgress

ipcMain.handle('job:cancel', async (_e, jobId: string) => {
  singleJobs.get(jobId)?.abort()
  singleJobProgress.delete(jobId)
  updateAppProgressBar()
  return cancelJob(jobId)
})

ipcMain.handle('media:trim', async (_e, opts: { jobId: string; input: string } & TrimParams): Promise<JobResult> => {
  const ctrl = new AbortController()
  singleJobs.set(opts.jobId, ctrl)
  singleJobProgress.set(opts.jobId, 1)
  updateAppProgressBar()
  try {
    const res = await trimTask(opts.input, { start: opts.start, end: opts.end, mode: opts.mode }, {
      jobId: opts.jobId,
      signal: ctrl.signal,
      onProgress: (percent, timemark) => {
        send('job:progress', { jobId: opts.jobId, percent, timemark })
        if (typeof percent === 'number') {
          singleJobProgress.set(opts.jobId, Math.min(100, Math.max(0, percent)))
          updateAppProgressBar()
        }
      }
    }, env)
    const name = path.basename(res.output)
    if (res.skipped) notify('裁剪已跳过', `${name} 已存在`, res.output)
    else {
      notify('裁剪完成', `${name}  ${formatSize(res.outputSize)}${res.notice ? `（${res.notice}）` : ''}`, res.output)
      afterFinish(res.output)
    }
    return res
  } catch (err) {
    const job = err instanceof JobFailedError ? err.job : mapError(err)
    if (job.code !== 'CANCELLED') notify('裁剪失败', `${path.basename(opts.input)}：${job.message}`)
    return { ok: false, error: job }
  } finally {
    singleJobs.delete(opts.jobId)
    singleJobProgress.delete(opts.jobId)
    updateAppProgressBar()
  }
})

ipcMain.handle('media:merge', async (_e, opts: { jobId: string; inputs: string[] } & MergeParams): Promise<JobResult> => {
  const ctrl = new AbortController()
  singleJobs.set(opts.jobId, ctrl)
  singleJobProgress.set(opts.jobId, 1)
  updateAppProgressBar()
  try {
    const res = await mergeTask(opts.inputs, { mode: opts.mode, normalizeAudio: opts.normalizeAudio }, {
      jobId: opts.jobId,
      signal: ctrl.signal,
      onProgress: (percent, timemark) => {
        send('job:progress', { jobId: opts.jobId, percent, timemark })
        if (typeof percent === 'number') {
          singleJobProgress.set(opts.jobId, Math.min(100, Math.max(0, percent)))
          updateAppProgressBar()
        }
      }
    }, env)
    const name = path.basename(res.output)
    if (res.skipped) notify('合并已跳过', `${name} 已存在`, res.output)
    else {
      notify('合并完成', `${name}  ${formatSize(res.outputSize)}${res.notice ? `（${res.notice}）` : ''}`, res.output)
      afterFinish(res.output)
    }
    return res
  } catch (err) {
    const job = err instanceof JobFailedError ? err.job : mapError(err)
    if (job.code !== 'CANCELLED') notify('合并失败', `${path.basename(opts.inputs[0] || '视频')}：${job.message}`)
    return { ok: false, error: job }
  } finally {
    singleJobs.delete(opts.jobId)
    singleJobProgress.delete(opts.jobId)
    updateAppProgressBar()
  }
})

async function frameToDataUrl(filePath: string, isTemp: boolean): Promise<string> {
  const ext = path.extname(filePath).toLowerCase()
  const mime = mimeFor(ext) || 'image/jpeg'
  const buf = await fs.promises.readFile(filePath)
  if (isTemp) {
    fs.promises.unlink(filePath).catch(() => {})
  }
  return `data:${mime};base64,${buf.toString('base64')}`
}

ipcMain.handle('media:compareFrames', async (_e, opts: { original: string; processed: string; timestamp?: number }) => {
  const ts = opts.timestamp ?? 1
  try {
    const [origFile, procFile] = await Promise.all([
      extractFrame(opts.original, ts),
      extractFrame(opts.processed, ts)
    ])
    const isOrigTemp = origFile !== opts.original
    const isProcTemp = procFile !== opts.processed
    const [originalThumb, processedThumb] = await Promise.all([
      frameToDataUrl(origFile, isOrigTemp),
      frameToDataUrl(procFile, isProcTemp)
    ])
    return {
      originalThumb,
      processedThumb
    }
  } catch (e) {
    console.error('[media:compareFrames] 截取对比帧失败', e)
    throw e
  }
})

ipcMain.handle('media:waveform', async (_e, opts: { input: string; bars?: number }): Promise<number[]> => {
  if (!opts?.input || !fs.existsSync(opts.input)) return []
  try {
    return await extractAudioWaveform(opts.input, opts.bars ?? 100)
  } catch (e) {
    console.warn('[media:waveform] 提取失败:', e)
    return []
  }
})

ipcMain.handle('media:contactSheet', async (_e, opts: { input: string; rows?: number; cols?: number; showTimecode?: boolean }): Promise<{ output: string; size: number; thumbUrl: string }> => {
  try {
    const res = await generateContactSheet(opts)
    allowMedia(res.output)
    const buf = await fs.promises.readFile(res.output)
    const thumbUrl = `data:image/jpeg;base64,${buf.toString('base64')}`
    return {
      output: res.output,
      size: res.size,
      thumbUrl
    }
  } catch (e) {
    console.error('[media:contactSheet] 生成失败:', e)
    throw e
  }
})

ipcMain.handle('media:detectSilence', async (_e, opts: { input: string; thresholdDb?: number; minDuration?: number }) => {
  try {
    return await detectSilence(opts.input, { thresholdDb: opts.thresholdDb, minDuration: opts.minDuration })
  } catch (e: any) {
    console.error('[media:detectSilence] 探测失败:', e)
    throw new Error(e?.message || '静音探测失败')
  }
})

ipcMain.handle('media:jumpCut', async (_e, opts: JumpCutParams): Promise<{ ok: boolean; output?: string; size?: number; cutCount?: number; savedSec?: number; error?: string }> => {
  const jobId = opts.jobId || `jumpcut_${Date.now()}`
  const ctrl = new AbortController()
  singleJobs.set(jobId, ctrl)
  singleJobProgress.set(jobId, 1)
  updateAppProgressBar()
  try {
    const res = await jumpCutMedia({
      ...opts,
      jobId,
      onProgress: (percent, timemark) => {
        send('job:progress', { jobId, percent, timemark })
        if (typeof percent === 'number') {
          singleJobProgress.set(jobId, Math.min(100, Math.max(0, percent)))
          updateAppProgressBar()
        }
      }
    })
    allowMedia(res.output)
    const name = path.basename(res.output)
    notify('智能跳剪完成', `${name} 已切除 ${res.cutCount} 处空白（节省 ${res.savedSec.toFixed(1)} 秒）`, res.output)
    afterFinish(res.output)
    return { ok: true, ...res }
  } catch (err: any) {
    const job = err instanceof JobFailedError ? err.job : mapError(err)
    if (job.code !== 'CANCELLED') notify('智能跳剪失败', `${path.basename(opts.input)}：${job.message}`)
    return { ok: false, error: job.message }
  } finally {
    singleJobs.delete(jobId)
    singleJobProgress.delete(jobId)
    updateAppProgressBar()
  }
})

ipcMain.handle('media:reframe', async (_e, opts: ReframeParams): Promise<{ ok: boolean; output?: string; size?: number; error?: string }> => {
  const jobId = opts.jobId || `reframe_${Date.now()}`
  const ctrl = new AbortController()
  singleJobs.set(jobId, ctrl)
  singleJobProgress.set(jobId, 1)
  updateAppProgressBar()
  try {
    const res = await reframeToVertical({
      ...opts,
      jobId,
      onProgress: (percent, timemark) => {
        send('job:progress', { jobId, percent, timemark })
        if (typeof percent === 'number') {
          singleJobProgress.set(jobId, Math.min(100, Math.max(0, percent)))
          updateAppProgressBar()
        }
      }
    })
    allowMedia(res.output)
    const name = path.basename(res.output)
    notify('竖屏重构完成', `${name} (${formatSize(res.size)})`, res.output)
    afterFinish(res.output)
    return { ok: true, ...res }
  } catch (err: any) {
    const job = err instanceof JobFailedError ? err.job : mapError(err)
    if (job.code !== 'CANCELLED') notify('竖屏重构失败', `${path.basename(opts.input)}：${job.message}`)
    return { ok: false, error: job.message }
  } finally {
    singleJobs.delete(jobId)
    singleJobProgress.delete(jobId)
    updateAppProgressBar()
  }
})

// 队列
ipcMain.handle('queue:snapshot', (_e, kind: QueueKind) => getQueue(kind).snapshot())
ipcMain.handle('queue:add', (_e, kind: QueueKind, paths: string[]) => {
  const valid = (paths || []).filter((p) => typeof p === 'string' && path.isAbsolute(p))
  getQueue(kind).add(valid)
  return getQueue(kind).snapshot()
})
ipcMain.handle('queue:start', (_e, kind: QueueKind, params: unknown) => { getQueue(kind).start(params); return true })
ipcMain.handle('queue:cancel', (_e, kind: QueueKind, id: string) => getQueue(kind).cancel(id))
ipcMain.handle('queue:cancelAll', (_e, kind: QueueKind) => { getQueue(kind).cancelAll(); return true })
ipcMain.handle('queue:remove', (_e, kind: QueueKind, id: string) => getQueue(kind).remove(id))
ipcMain.handle('queue:retry', (_e, kind: QueueKind, id: string) => getQueue(kind).retry(id))
ipcMain.handle('queue:clearFinished', (_e, kind: QueueKind) => getQueue(kind).clearFinished())
ipcMain.handle('queue:clearAll', (_e, kind: QueueKind) => { getQueue(kind).clearAll(); return true })

// 设置
ipcMain.handle('settings:get', () => settingsStore.get())
ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
  const s = settingsStore.update(patch || {})
  applySettings(s)
  send('settings:changed', s)
  return s
})
ipcMain.handle('settings:reset', () => {
  const s = settingsStore.reset()
  applySettings(s)
  send('settings:changed', s)
  return s
})
ipcMain.handle('settings:export', async () => {
  if (!mainWindow) return { success: false }
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '导出转码与性能配置预设',
    defaultPath: 'ffmpeg-desktop-settings.json',
    filters: [{ name: 'JSON 配置文件', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePath) return { success: false }
  try {
    fs.writeFileSync(res.filePath, JSON.stringify(settingsStore.get(), null, 2), 'utf8')
    return { success: true, path: res.filePath }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
})
ipcMain.handle('settings:import', async () => {
  if (!mainWindow) return { success: false }
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '导入转码与性能配置预设',
    properties: ['openFile'],
    filters: [{ name: 'JSON 配置文件', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePaths?.[0]) return { success: false }
  try {
    const raw = fs.readFileSync(res.filePaths[0], 'utf8')
    const parsed = JSON.parse(raw)
    const sanitized = sanitizeSettings(parsed)
    const updated = settingsStore.replace(sanitized)
    applySettings(updated)
    send('settings:changed', updated)
    return { success: true, settings: updated }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: `导入失败：配置文件格式不正确 (${msg})` }
  }
})
ipcMain.handle('settings:path', () => path.join(app.getPath('userData'), 'settings.json'))

// 硬件加速
ipcMain.handle('hw:get', () => encoderInfo)
ipcMain.handle('hw:redetect', async () => {
  encoderInfo = { ...encoderInfo, ready: false }
  send('hw:info', encoderInfo)
  encoderInfo = await detectHwEncoders()
  send('hw:info', encoderInfo)
  return encoderInfo
})

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch
}))
