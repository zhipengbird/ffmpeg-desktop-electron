import { utilityProcess, type UtilityProcess } from 'electron'
import path from 'path'
import {
  compressImage, compressImageWithFfmpeg, getImageInfo, getImageInfoWithFfprobe,
  JobFailedError, type ImageCompressOptions
} from './core'
import type { JobError } from '../shared/types'

type Pending = { resolve: (v: any) => void; reject: (e: unknown) => void }

export const FFMPEG_FALLBACK_NOTICE = '当前系统上 sharp 图片引擎不可用（Electron 与 libvips 的 glib 版本冲突），已自动改用 FFmpeg 编码'

/**
 * 图片引擎：
 * - macOS / Windows：与原来一样在主进程直接调用 sharp。
 * - Linux：sharp 运行在独立的 utilityProcess 中；若该进程崩溃（glib 冲突），
 *   本次会话改用 FFmpeg 编码图片，应用本身不受影响。
 */
export class ImageEngine {
  private worker: UtilityProcess | null = null
  private pending = new Map<number, Pending>()
  private seq = 0
  private sharpBroken = false
  readonly isolated: boolean

  constructor(private readonly workerPath = path.join(__dirname, 'image-worker.js')) {
    this.isolated = process.platform === 'linux'
  }

  get usingFallback(): boolean { return this.sharpBroken }

  private ensureWorker(): UtilityProcess {
    if (this.worker) return this.worker
    const w = utilityProcess.fork(this.workerPath, [], { serviceName: 'media-toolbox-image', stdio: 'inherit' })
    w.on('message', (m: { id: number; ok: boolean; result?: unknown; error?: JobError }) => {
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      if (m.ok) p.resolve(m.result)
      else p.reject(new JobFailedError(m.error!))
    })
    w.on('exit', (code) => {
      this.worker = null
      if (this.pending.size) {
        console.warn(`[image] sharp 子进程异常退出（code=${code}），改用 FFmpeg 图片引擎`)
        this.sharpBroken = true
        const err = new Error('SHARP_WORKER_CRASHED')
        for (const p of this.pending.values()) p.reject(err)
        this.pending.clear()
      }
    })
    this.worker = w
    return w
  }

  private call<T>(op: 'compress' | 'info' | 'ping', opts?: unknown): Promise<T> {
    const w = this.ensureWorker()
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      w.postMessage({ id, op, opts })
    })
  }

  private isCrash(e: unknown): boolean {
    return e instanceof Error && e.message === 'SHARP_WORKER_CRASHED'
  }

  /** 启动时预检（仅 Linux）：提前发现 sharp 不可用，避免第一张图片才失败。 */
  async warmup(): Promise<void> {
    if (!this.isolated || this.sharpBroken) return
    try {
      await this.call('ping')
      console.log('[image] sharp 子进程正常')
    } catch (e) {
      if (!this.isCrash(e)) console.warn('[image] sharp 预检失败', e)
    }
  }

  async compress(opts: ImageCompressOptions & { jobId: string }): Promise<{ notice?: string }> {
    if (!this.isolated) {
      if (!this.sharpBroken) {
        try {
          await compressImage(opts)
          return {}
        } catch (e) {
          const msg = (e as Error)?.message || String(e)
          console.warn(`[image] sharp 图片引擎执行异常（${msg}），本次会话自动降级为 FFmpeg 编码`)
          this.sharpBroken = true
        }
      }
      await compressImageWithFfmpeg(opts)
      return { notice: FFMPEG_FALLBACK_NOTICE }
    }
    if (!this.sharpBroken) {
      try {
        await this.call('compress', opts)
        return {}
      } catch (e) {
        if (!this.isCrash(e)) throw e
      }
    }
    await compressImageWithFfmpeg(opts)
    return { notice: FFMPEG_FALLBACK_NOTICE }
  }

  async info(filePath: string): Promise<{ width: number; height: number; format: string; size: number }> {
    if (!this.isolated) {
      if (!this.sharpBroken) {
        try {
          return await getImageInfo(filePath)
        } catch (e) {
          const msg = (e as Error)?.message || String(e)
          console.warn(`[image] sharp 读取元数据失败（${msg}），降级为 ffprobe`)
          this.sharpBroken = true
        }
      }
      return getImageInfoWithFfprobe(filePath)
    }
    if (!this.sharpBroken) {
      try {
        return await this.call('info', { path: filePath })
      } catch (e) {
        if (!this.isCrash(e)) throw e
      }
    }
    return getImageInfoWithFfprobe(filePath)
  }

  dispose(): void {
    try { this.worker?.kill() } catch { /* ignore */ }
    this.worker = null
  }
}
