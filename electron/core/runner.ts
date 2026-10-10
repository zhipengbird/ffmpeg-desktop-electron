import os from 'os'
import { spawn, type ChildProcess } from 'child_process'
import { getFfmpegPath } from './binaries'
import { JobFailedError, mapError } from './errors'
import { ProgressParser, computePercent, formatTimemark, parseStderrTime } from './progress'

/** percent 为 null 表示总时长未知（不确定进度）。 */
export type ProgressCallback = (percent: number | null, timemark?: string) => void

const activeJobs = new Map<string, ChildProcess>()
const cancelledJobs = new Set<string>()
let globalQuietMode = false

export function setGlobalQuietMode(enabled: boolean): void {
  globalQuietMode = Boolean(enabled)
}

export function getGlobalQuietMode(): boolean {
  return globalQuietMode
}

export function cancelJob(jobId: string): boolean {
  const proc = activeJobs.get(jobId)
  if (proc) {
    cancelledJobs.add(jobId)
    killProc(proc)
    return true
  }
  return false
}

export function cancelAllJobs(): void {
  for (const [id, proc] of activeJobs) {
    cancelledJobs.add(id)
    killProc(proc)
  }
}

export function isJobActive(jobId: string): boolean {
  return activeJobs.has(jobId)
}

function killProc(proc: ChildProcess): void {
  try {
    // 先尝试让 ffmpeg 优雅退出（写入 q），再强制结束
    proc.stdin?.write('q')
  } catch { /* ignore */ }
  try { proc.kill('SIGTERM') } catch { /* ignore */ }
  const t = setTimeout(() => {
    try { if (proc.exitCode === null) proc.kill('SIGKILL') } catch { /* ignore */ }
  }, 3000)
  t.unref?.()
}

const MAX_STDERR = 64 * 1024

export interface RunOptions {
  jobId: string
  args: string[]
  /** 媒体总时长（秒）；<=0 表示未知，进度将为 null */
  duration: number
  onProgress?: ProgressCallback
  /** 进度回调节流间隔（毫秒） */
  throttleMs?: number
  /** 是否启用后台安静防卡顿模式（留出一半 CPU 核心并降低系统调度优先级，未提供时遵循全局设置） */
  quietMode?: boolean
}

/**
 * 运行 ffmpeg。自动添加 `-y -hide_banner -progress pipe:1`，
 * 优先解析 stdout 中的 out_time_us/out_time_ms，没有时退回 stderr 的 time=。
 * 失败时抛出 JobFailedError（含中文提示与日志尾部）。
 */
export function runFfmpeg(opts: RunOptions): Promise<void> {
  const { jobId, args, duration, onProgress } = opts
  const throttle = opts.throttleMs ?? 200
  const isQuiet = opts.quietMode ?? globalQuietMode
  return new Promise((resolve, reject) => {
    if (cancelledJobs.has(jobId)) {
      cancelledJobs.delete(jobId)
      reject(new JobFailedError({ code: 'CANCELLED', message: '任务已取消' }))
      return
    }
    const threadArgs = isQuiet && !args.includes('-threads')
      ? ['-threads', String(Math.max(1, Math.floor((os.cpus()?.length || 4) / 2)))]
      : []
    const fullArgs = ['-y', '-hide_banner', '-progress', 'pipe:1', ...threadArgs, ...args]
    let proc: ChildProcess
    try {
      proc = spawn(getFfmpegPath(), fullArgs, { windowsHide: true })
      if (isQuiet && proc.pid) {
        try {
          os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
        } catch {
          // 部分环境或系统权限限制时忽略
        }
      }
    } catch (err) {
      reject(new JobFailedError(mapError(err)))
      return
    }
    activeJobs.set(jobId, proc)
    let stderr = ''
    let gotPipeProgress = false
    let lastEmit = 0
    let lastSec = -1

    const emit = (sec: number | null, force = false) => {
      if (!onProgress || sec === null) return
      const now = Date.now()
      if (!force && now - lastEmit < throttle) return
      if (sec === lastSec && !force) return
      lastEmit = now
      lastSec = sec
      onProgress(computePercent(sec, duration), formatTimemark(sec))
    }

    const parser = new ProgressParser()
    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (d: string) => {
      for (const block of parser.push(d)) {
        if (block.outTime !== null) {
          gotPipeProgress = true
          emit(block.outTime, block.end)
        }
      }
    })
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (text: string) => {
      stderr += text
      if (stderr.length > MAX_STDERR) stderr = stderr.slice(-MAX_STDERR)
      if (!gotPipeProgress) emit(parseStderrTime(text))
    })
    proc.stdin?.on('error', () => { /* ignore EPIPE */ })

    let settled = false
    proc.on('error', (err) => {
      activeJobs.delete(jobId)
      if (settled) return
      settled = true
      cancelledJobs.delete(jobId)
      reject(new JobFailedError(mapError(err, { stderr })))
    })
    proc.on('close', (code, signal) => {
      activeJobs.delete(jobId)
      if (settled) return
      settled = true
      const cancelled = cancelledJobs.delete(jobId)
      if (cancelled) {
        reject(new JobFailedError(mapError(null, { cancelled: true, stderr })))
      } else if (code === 0) {
        onProgress?.(100)
        resolve()
      } else {
        reject(new JobFailedError(mapError(signal ? `killed by ${signal}` : '', { exitCode: code, stderr })))
      }
    })
  })
}
