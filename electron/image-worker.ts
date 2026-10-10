/**
 * 图片处理子进程（Electron utilityProcess）。
 * sharp 在部分 Linux 发行版的 Electron 进程内会因 glib 版本冲突而直接崩溃（断言失败），
 * 放在独立进程里运行可避免拖垮主进程，并让主进程检测到后回退到 FFmpeg。
 */
import { compressImage, getImageInfo } from './core/image'
import { JobFailedError, mapError } from './core/errors'

interface Req { id: number; op: 'compress' | 'info' | 'ping'; opts?: any }

const port = (process as unknown as { parentPort: { on: (e: 'message', cb: (m: { data: Req }) => void) => void; postMessage: (m: unknown) => void } }).parentPort

port.on('message', async ({ data }) => {
  const { id, op, opts } = data
  try {
    let result: unknown
    if (op === 'compress') result = await compressImage(opts)
    else if (op === 'info') result = await getImageInfo(opts.path)
    else {
      // 健康检查：真正调用一次 libvips（1×1 PNG）
      const sharp = (await import('sharp')).default
      await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } }).png().toBuffer()
      result = 'pong'
    }
    port.postMessage({ id, ok: true, result })
  } catch (e) {
    port.postMessage({ id, ok: false, error: e instanceof JobFailedError ? e.job : mapError(e) })
  }
})
