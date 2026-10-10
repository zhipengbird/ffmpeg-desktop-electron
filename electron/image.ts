import path from 'path'
import fs from 'fs'

export type ImagePreset = 'high' | 'balanced' | 'small'

const QUALITY: Record<ImagePreset, number> = {
  high: 90,
  balanced: 75,
  small: 50
}

export interface ImageCompressOptions {
  input: string
  output: string
  preset: ImagePreset
  customQuality?: number
  format?: 'jpeg' | 'png' | 'webp'
}

export async function compressImage(opts: ImageCompressOptions): Promise<string> {
  const sharp = (await import('sharp')).default
  const { input, output, preset, customQuality, format } = opts
  const quality = customQuality ?? QUALITY[preset]
  const ext = (format || path.extname(output).slice(1).toLowerCase() || 'jpeg') as string

  let pipeline = sharp(input).rotate()

  if (ext === 'jpg' || ext === 'jpeg') {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true })
  } else if (ext === 'png') {
    const compressionLevel = preset === 'high' ? 6 : preset === 'balanced' ? 8 : 9
    pipeline = pipeline.png({ compressionLevel, quality })
  } else if (ext === 'webp') {
    pipeline = pipeline.webp({ quality })
  } else {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true })
  }

  await pipeline.toFile(output)
  return output
}

export async function getImageInfo(filePath: string): Promise<{
  width: number
  height: number
  format: string
  size: number
}> {
  const sharp = (await import('sharp')).default
  const meta = await sharp(filePath).metadata()
  const stat = fs.statSync(filePath)
  return {
    width: meta.width || 0,
    height: meta.height || 0,
    format: meta.format || path.extname(filePath).slice(1),
    size: stat.size
  }
}
