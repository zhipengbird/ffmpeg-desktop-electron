import path from 'path'
import fs from 'fs'
import type { QualityPreset } from '../../shared/types'
import { JobFailedError, mapError } from './errors'
import { withTempOutput } from './media'
import { runFfmpeg } from './runner'
import { probeMedia } from './probe'

export type ImageFormat = 'jpeg' | 'png' | 'webp'
export type ImageFormatChoice = ImageFormat | 'keep'

const QUALITY: Record<QualityPreset, number> = { high: 90, balanced: 75, small: 50 }

/** 解析输出格式：keep = 保持原格式（不支持的格式转 JPEG）。 */
export function resolveImageFormat(input: string, choice: ImageFormatChoice | undefined): ImageFormat {
  if (choice && choice !== 'keep') return choice
  const e = path.extname(input).slice(1).toLowerCase()
  if (e === 'jpg' || e === 'jpeg') return 'jpeg'
  if (e === 'png' || e === 'webp') return e
  return 'jpeg'
}

export function imageExt(format: ImageFormat): string {
  return format === 'jpeg' ? '.jpg' : `.${format}`
}

export interface ImageCompressOptions {
  input: string
  output: string
  preset: QualityPreset
  customQuality?: number
  format: ImageFormat
}

async function loadSharp() {
  return (await import('sharp')).default
}

export async function compressImage(opts: ImageCompressOptions): Promise<string> {
  const { input, output, preset, customQuality, format } = opts
  if (!fs.existsSync(input)) throw new JobFailedError(mapError(`${input}: No such file or directory`))
  const sharp = await loadSharp()
  const quality = Math.min(100, Math.max(1, Math.round(customQuality ?? QUALITY[preset])))
  try {
    await withTempOutput(output, async (tmp) => {
      let pipeline = sharp(input, { failOn: 'error' }).rotate()
      if (format === 'png') {
        // 高质量：无损最大压缩；其余：调色板量化（体积显著减小）
        const lossless = customQuality === undefined ? preset === 'high' : quality >= 100
        pipeline = lossless
          ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
          : pipeline.png({ compressionLevel: 9, palette: true, quality, effort: 8 })
      } else if (format === 'webp') {
        pipeline = pipeline.webp({ quality, effort: 5 })
      } else {
        pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true })
      }
      await pipeline.toFile(tmp)
    })
  } catch (e) {
    if (e instanceof JobFailedError) throw e
    throw new JobFailedError(mapError(e))
  }
  return output
}

export async function getImageInfo(filePath: string): Promise<{ width: number; height: number; format: string; size: number }> {
  const sharp = await loadSharp()
  const meta = await sharp(filePath).metadata()
  const stat = fs.statSync(filePath)
  return {
    width: meta.width || 0,
    height: meta.height || 0,
    format: meta.format || path.extname(filePath).slice(1),
    size: stat.size
  }
}

/** 质量 1–100 → mjpeg 的 -q:v（2 最好，31 最差） */
export function jpegQscale(quality: number): number {
  const q = Math.min(100, Math.max(1, quality))
  return Math.round(2 + ((100 - q) * 29) / 99)
}

/**
 * 备用图片引擎：用 FFmpeg 编码（当 sharp 在当前系统不可用时使用，
 * 例如部分 Linux 发行版上 Electron 与 sharp 内置 glib 冲突）。
 */
export async function compressImageWithFfmpeg(opts: ImageCompressOptions & { jobId: string }): Promise<string> {
  const { input, output, preset, customQuality, format, jobId } = opts
  if (!fs.existsSync(input)) throw new JobFailedError(mapError(`${input}: No such file or directory`))
  const quality = Math.min(100, Math.max(1, Math.round(customQuality ?? QUALITY[preset])))
  let codec: string[]
  if (format === 'png') {
    const lossless = customQuality === undefined ? preset === 'high' : quality >= 100
    codec = lossless
      ? ['-c:v', 'png', '-compression_level', '9', '-pred', 'mixed']
      : ['-vf', `split[a][b];[a]palettegen=max_colors=${quality >= 60 ? 256 : 128}:stats_mode=single[p];[b][p]paletteuse=dither=sierra2_4a`, '-c:v', 'png', '-compression_level', '9']
  } else if (format === 'webp') {
    codec = ['-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '5']
  } else {
    codec = ['-vf', 'format=yuvj420p', '-c:v', 'mjpeg', '-q:v', String(jpegQscale(quality))]
  }
  await withTempOutput(output, (tmp) => runFfmpeg({
    jobId, args: ['-i', input, '-frames:v', '1', '-map_metadata', '-1', ...codec, '-update', '1', tmp], duration: 0
  }))
  return output
}

export async function getImageInfoWithFfprobe(filePath: string): Promise<{ width: number; height: number; format: string; size: number }> {
  const info = await probeMedia(filePath)
  const f = info.video?.codec || path.extname(filePath).slice(1)
  return {
    width: info.video?.width || 0,
    height: info.video?.height || 0,
    format: f === 'mjpeg' ? 'jpeg' : f,
    size: fs.statSync(filePath).size
  }
}
