import path from 'path'
import fs from 'fs'
import os from 'os'
import type { QualityPreset } from '../../shared/types'
import { runFfmpeg, type ProgressCallback } from './runner'
import { probeMedia, type MediaInfo } from './probe'
import { JobFailedError } from './errors'
import { hwEncoderSpec, softwareSpec, targetBitrateKbps, type VideoEncoderSpec } from './hwaccel'

export interface MediaOpResult {
  output: string
  /** 实际使用的视频编码器（若有视频编码） */
  encoder?: string
  notice?: string
}

interface BaseOpts {
  jobId: string
  input: string
  output: string
  onProgress?: ProgressCallback
  /** 预先探测到的媒体信息（可省略） */
  info?: MediaInfo | null
  /** 是否擦除敏感元数据 (EXIF, GPS, 录制时间, 章节等) */
  stripMetadata?: boolean
  /** 是否应用 EBU R128 广播级智能音量标准化 (-16 LUFS) */
  normalizeAudio?: boolean
}

/** 隐私元数据清理参数：-map_metadata -1 -map_chapters -1 */
export function metadataArgs(strip?: boolean): string[] {
  return strip ? ['-map_metadata', '-1', '-map_chapters', '-1'] : []
}

/** 广播级智能音量标准化滤镜参数 (EBU R128: 靶向 -16 LUFS, 最大峰值 -1.5 dB) */
export function loudnormArgs(normalize?: boolean): string[] {
  return normalize ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11'] : []
}

/** 软件编码速度预设：质量档位不变，但避免 slow 带来的过长耗时。 */
export const VIDEO_PRESETS: Record<QualityPreset, { crf: number; preset: string; audioBitrate: string }> = {
  high: { crf: 18, preset: 'medium', audioBitrate: '192k' },
  balanced: { crf: 23, preset: 'medium', audioBitrate: '128k' },
  small: { crf: 28, preset: 'fast', audioBitrate: '96k' }
}

export const AUDIO_PRESETS: Record<QualityPreset, string> = { high: '256k', balanced: '128k', small: '64k' }

export async function safeProbe(input: string): Promise<MediaInfo | null> {
  try { return await probeMedia(input) } catch { return null }
}

/** 是否“纯音频”（没有真正的视频流；封面图不算）。 */
export function isAudioOnly(info: MediaInfo | null, input: string): boolean {
  if (info) return !info.video
  return ['.mp3', '.aac', '.wav', '.flac', '.m4a', '.ogg', '.opus', '.wma'].includes(path.extname(input).toLowerCase())
}

/** 有损音频压缩时的输出扩展名与编码器。无损/不常见格式统一转 MP3。 */
export function audioTargetFor(inputExt: string): { ext: string; codec: string } {
  const e = inputExt.toLowerCase()
  if (e === '.m4a' || e === '.aac') return { ext: e, codec: 'aac' }
  if (e === '.ogg') return { ext: '.ogg', codec: 'libvorbis' }
  if (e === '.opus') return { ext: '.opus', codec: 'libopus' }
  return { ext: '.mp3', codec: 'libmp3lame' }
}

/** 按输出扩展名选择音频编码参数（用于精准裁剪 / 分离）。 */
export function audioCodecArgsForExt(ext: string, bitrate = '192k'): string[] {
  switch (ext.toLowerCase()) {
    case '.wav': return ['-c:a', 'pcm_s16le']
    case '.flac': return ['-c:a', 'flac']
    case '.m4a':
    case '.aac': return ['-c:a', 'aac', '-b:a', bitrate]
    case '.ogg': return ['-c:a', 'libvorbis', '-b:a', bitrate]
    case '.opus': return ['-c:a', 'libopus', '-b:a', bitrate]
    default: return ['-c:a', 'libmp3lame', '-b:a', bitrate]
  }
}

/** 写入同目录的临时文件，成功后原子替换为目标文件；失败/取消时清理临时文件。 */
export async function withTempOutput<T>(output: string, fn: (tmp: string) => Promise<T>): Promise<T> {
  const dir = path.dirname(output)
  const ext = path.extname(output)
  const base = path.basename(output, ext)
  const tmp = path.join(dir, `.${base}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.partial${ext}`)
  try {
    const r = await fn(tmp)
    fs.renameSync(tmp, output)
    return r
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }) } catch { /* ignore */ }
    throw e
  }
}

function videoArgs(spec: VideoEncoderSpec): string[] {
  return [...(spec.vf ? ['-vf', spec.vf] : []), ...spec.args]
}

function containerArgs(output: string): string[] {
  const e = path.extname(output).toLowerCase()
  return e === '.mp4' || e === '.mov' || e === '.m4v' ? ['-movflags', '+faststart'] : []
}

/**
 * 以给定视频编码器运行；硬件编码失败（非取消）时自动回退 libx264。
 */
async function runWithFallback(
  o: BaseOpts,
  duration: number,
  hwEncoder: string | null,
  quality: QualityPreset | { crf: number },
  swCrf: number,
  swPreset: string,
  build: (spec: VideoEncoderSpec) => string[],
  tmp: string
): Promise<{ encoder: string; notice?: string }> {
  const sw = softwareSpec(swCrf, swPreset)
  if (hwEncoder) {
    const v = o.info?.video
    const kbps = targetBitrateKbps(quality, { width: v?.width, height: v?.height, fps: v?.fps, srcBitrate: v?.bitrate || o.info?.bitrate })
    const hw = hwEncoderSpec(hwEncoder, kbps)
    try {
      await runFfmpeg({ jobId: o.jobId, args: [...build(hw), tmp], duration, onProgress: o.onProgress })
      return { encoder: hwEncoder }
    } catch (e) {
      if (e instanceof JobFailedError && e.job.code === 'CANCELLED') throw e
      o.onProgress?.(duration > 0 ? 0 : null)
      await runFfmpeg({ jobId: o.jobId, args: [...build(sw), tmp], duration, onProgress: o.onProgress })
      return { encoder: 'libx264', notice: `硬件编码（${hwEncoder}）失败，已自动回退到软件编码 libx264` }
    }
  }
  await runFfmpeg({ jobId: o.jobId, args: [...build(sw), tmp], duration, onProgress: o.onProgress })
  return { encoder: 'libx264' }
}

/**
 * 根据目标文件大小（MB）和媒体时长（秒）计算目标视频码率（kbps）及音频码率。
 * 预留 5% 容器开销（moov box / headers 等）以确保不超出限制。
 */
export function calcTargetBitrates(targetSizeMB: number, durationSec: number): { videoKbps: number; audioBitrate: string } {
  const d = Math.max(0.5, durationSec)
  const targetBytes = targetSizeMB * 1024 * 1024 * 0.95
  const totalKbps = (targetBytes * 8) / (d * 1000)

  let audioKbps = 128
  if (totalKbps < 280) audioKbps = 64
  else if (totalKbps < 500) audioKbps = 96

  const videoKbps = Math.max(64, Math.round(totalKbps - audioKbps))
  return { videoKbps, audioBitrate: `${audioKbps}k` }
}

export interface CompressOpts extends BaseOpts {
  preset: QualityPreset
  customCrf?: number
  customAudioBitrate?: string
  targetSizeMB?: number
  hwEncoder?: string | null
}

export async function compressMedia(o: CompressOpts): Promise<MediaOpResult> {
  const info = o.info !== undefined ? o.info : await safeProbe(o.input)
  const duration = info?.duration || 0
  const isTargetSize = typeof o.targetSizeMB === 'number' && o.targetSizeMB > 0

  if (isAudioOnly(info, o.input)) {
    let bitrate = o.customAudioBitrate || AUDIO_PRESETS[o.preset]
    if (isTargetSize && duration > 0) {
      const targetAudioKbps = Math.floor((o.targetSizeMB! * 1024 * 1024 * 0.95 * 8) / (Math.max(1, duration) * 1000))
      bitrate = `${Math.min(320, Math.max(32, targetAudioKbps))}k`
    }
    const ext = path.extname(o.output)
    const meta = metadataArgs(o.stripMetadata)
    const norm = loudnormArgs(o.normalizeAudio)
    await withTempOutput(o.output, (tmp) => runFfmpeg({
      jobId: o.jobId,
      args: ['-i', o.input, '-vn', ...(meta.length ? meta : ['-map_metadata', '0']), ...norm, ...audioCodecArgsForExt(ext, bitrate), tmp],
      duration, onProgress: o.onProgress
    }))
    return { output: o.output, notice: isTargetSize ? `目标体积：${o.targetSizeMB} MB` : undefined }
  }

  // 视频目标大小锁定模式：根据时长精确反算码率并通过限速控制体积
  if (isTargetSize && duration > 0) {
    const { videoKbps, audioBitrate } = calcTargetBitrates(o.targetSizeMB!, duration)
    const audioBr = o.customAudioBitrate || audioBitrate
    const maxRate = Math.round(videoKbps * 1.3)
    const bufSize = Math.round(videoKbps * 2)

    // 软件编码使用固定码率约束；硬件加速使用平台对应码率配置
    const swTargetSpec: VideoEncoderSpec = {
      name: 'libx264',
      hardware: false,
      args: ['-c:v', 'libx264', '-preset', 'medium', '-b:v', `${videoKbps}k`, '-maxrate', `${maxRate}k`, '-bufsize', `${bufSize}k`, '-pix_fmt', 'yuv420p'],
      preInput: []
    }

    if (o.hwEncoder) {
      const hw = hwEncoderSpec(o.hwEncoder, videoKbps)
      try {
        await withTempOutput(o.output, (tmp) => runFfmpeg({
          jobId: o.jobId,
          args: [...hw.preInput, '-i', o.input, '-map', '0:V:0', '-map', '0:a?', ...videoArgs(hw), '-c:a', 'aac', '-b:a', audioBr, ...loudnormArgs(o.normalizeAudio), ...metadataArgs(o.stripMetadata), ...containerArgs(o.output), tmp],
          duration, onProgress: o.onProgress
        }))
        return { output: o.output, encoder: o.hwEncoder, notice: `目标体积：${o.targetSizeMB} MB（码率 ${videoKbps}k）` }
      } catch (e) {
        if (e instanceof JobFailedError && e.job.code === 'CANCELLED') throw e
        // 硬件编码异常降级到 libx264
      }
    }

    await withTempOutput(o.output, (tmp) => runFfmpeg({
      jobId: o.jobId,
      args: ['-i', o.input, '-map', '0:V:0', '-map', '0:a?', ...videoArgs(swTargetSpec), '-c:a', 'aac', '-b:a', audioBr, ...loudnormArgs(o.normalizeAudio), ...metadataArgs(o.stripMetadata), ...containerArgs(o.output), tmp],
      duration, onProgress: o.onProgress
    }))
    return { output: o.output, encoder: 'libx264', notice: `目标体积：${o.targetSizeMB} MB（码率 ${videoKbps}k）` }
  }

  // 常规预设 (CRF) 模式
  const p = VIDEO_PRESETS[o.preset]
  const crf = o.customCrf ?? p.crf
  const audioBr = o.customAudioBitrate || p.audioBitrate
  const quality = o.customCrf !== undefined ? { crf: o.customCrf } : o.preset
  const r = await withTempOutput(o.output, (tmp) => runWithFallback(
    { ...o, info }, duration, o.hwEncoder ?? null, quality, crf, p.preset,
    (spec) => [...spec.preInput, '-i', o.input, '-map', '0:V:0', '-map', '0:a?', ...videoArgs(spec), '-c:a', 'aac', '-b:a', audioBr, ...loudnormArgs(o.normalizeAudio), ...metadataArgs(o.stripMetadata), ...containerArgs(o.output)],
    tmp
  ))
  return { output: o.output, ...r }
}

export const CONVERT_FORMATS = ['mp4', 'mkv', 'webm', 'gif', 'webp', 'mp3', 'aac', 'wav'] as const
export type ConvertFormat = (typeof CONVERT_FORMATS)[number]

export interface ConvertOpts extends BaseOpts {
  format: string
  hwEncoder?: string | null
  gifFps?: number
  gifWidth?: number
}

export async function convertFormat(o: ConvertOpts): Promise<MediaOpResult> {
  const info = o.info !== undefined ? o.info : await safeProbe(o.input)
  const duration = info?.duration || 0
  const f = o.format.toLowerCase()

  if (f === 'gif') {
    if (info && !info.video) throw new JobFailedError({ code: 'FORMAT', message: '该文件没有视频流，无法转换为动图 GIF' })
    const fps = o.gifFps && [10, 15, 24, 30].includes(o.gifFps) ? o.gifFps : 15
    const width = o.gifWidth && o.gifWidth > 0 ? o.gifWidth : 480
    // 高清调色板双遍复合滤镜：lanczos 等比缩放 + palettegen 抽取最佳 256 色 + paletteuse bayer 抖动合成
    const filter = `[0:v] fps=${fps},scale=${width}:-1:flags=lanczos,split [a][b]; [a] palettegen=reserve_transparent=0:stats_mode=diff [p]; [b][p] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`
    await withTempOutput(o.output, (tmp) => runFfmpeg({
      jobId: o.jobId,
      args: ['-i', o.input, '-vf', filter, '-an', ...metadataArgs(o.stripMetadata), tmp],
      duration,
      onProgress: o.onProgress
    }))
    return { output: o.output, encoder: 'palettegen+paletteuse' }
  }

  if (f === 'webp') {
    if (info && !info.video) throw new JobFailedError({ code: 'FORMAT', message: '该文件没有视频流，无法转换为动图 WebP' })
    const fps = o.gifFps && [10, 15, 24, 30].includes(o.gifFps) ? o.gifFps : 15
    const width = o.gifWidth && o.gifWidth > 0 ? o.gifWidth : 480
    const filter = `fps=${fps},scale=${width}:-1:flags=lanczos`
    await withTempOutput(o.output, (tmp) => runFfmpeg({
      jobId: o.jobId,
      args: ['-i', o.input, '-vcodec', 'libwebp', '-lossless', '0', '-compression_level', '4', '-q:v', '75', '-loop', '0', '-vf', filter, '-an', ...metadataArgs(o.stripMetadata), tmp],
      duration,
      onProgress: o.onProgress
    }))
    return { output: o.output, encoder: 'libwebp' }
  }

  if (f === 'mp4' || f === 'mkv') {
    if (info && !info.video) throw new JobFailedError({ code: 'FORMAT', message: '该文件没有视频流，无法转换为视频格式（请选择音频格式）' })
    const r = await withTempOutput(o.output, (tmp) => runWithFallback(
      { ...o, info }, duration, o.hwEncoder ?? null, 'balanced', 23, 'medium',
      (spec) => [...spec.preInput, '-i', o.input, '-map', '0:V:0', '-map', '0:a?', ...videoArgs(spec), '-c:a', 'aac', '-b:a', '192k', ...loudnormArgs(o.normalizeAudio), ...metadataArgs(o.stripMetadata), ...(f === 'mp4' ? ['-movflags', '+faststart'] : [])],
      tmp
    ))
    return { output: o.output, ...r }
  }
  let args: string[]
  switch (f) {
    case 'webm':
      if (info && !info.video) throw new JobFailedError({ code: 'FORMAT', message: '该文件没有视频流，无法转换为视频格式（请选择音频格式）' })
      args = ['-i', o.input, '-map', '0:V:0', '-map', '0:a?', '-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '128k', ...loudnormArgs(o.normalizeAudio), ...metadataArgs(o.stripMetadata)]
      break
    case 'mp3': args = ['-i', o.input, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', ...loudnormArgs(o.normalizeAudio), ...metadataArgs(o.stripMetadata)]; break
    case 'aac': args = ['-i', o.input, '-vn', '-c:a', 'aac', '-b:a', '192k', ...loudnormArgs(o.normalizeAudio), ...metadataArgs(o.stripMetadata)]; break
    case 'wav': args = ['-i', o.input, '-vn', '-c:a', 'pcm_s16le', ...loudnormArgs(o.normalizeAudio), ...metadataArgs(o.stripMetadata)]; break
    default: args = ['-i', o.input, '-c', 'copy', ...metadataArgs(o.stripMetadata)]
  }
  await withTempOutput(o.output, (tmp) => runFfmpeg({ jobId: o.jobId, args: [...args, tmp], duration, onProgress: o.onProgress }))
  return { output: o.output, encoder: f === 'webm' ? 'libvpx-vp9' : undefined }
}

export type SeparateMode = 'audio' | 'video' | 'audio-copy'

export interface SeparateOpts extends BaseOpts {
  mode: SeparateMode
}

/** 流复制提取音频时根据编码器推导最佳容器后缀 */
export function rawAudioExt(codecName?: string): string {
  const c = (codecName || '').toLowerCase()
  if (c === 'aac') return '.m4a'
  if (c === 'mp3') return '.mp3'
  if (c === 'opus') return '.opus'
  if (c === 'flac') return '.flac'
  if (c === 'vorbis') return '.ogg'
  if (c === 'alac') return '.m4a'
  if (c.startsWith('pcm_')) return '.wav'
  return '.m4a'
}

/** 无声视频输出容器：尽量沿用源容器，avi/flv 等改用 mkv 以兼容流复制。 */
export function silentVideoExt(input: string): string {
  const e = path.extname(input).toLowerCase()
  return ['.mp4', '.mkv', '.webm', '.mov', '.m4v'].includes(e) ? e : '.mkv'
}

export async function separateStreams(o: SeparateOpts): Promise<MediaOpResult> {
  const info = o.info !== undefined ? o.info : await safeProbe(o.input)
  const duration = info?.duration || 0
  if (o.mode === 'audio') {
    if (info && !info.audio) throw new JobFailedError({ code: 'FORMAT', message: '该文件没有音频流，无法提取音频' })
    const ext = path.extname(o.output)
    await withTempOutput(o.output, (tmp) => runFfmpeg({
      jobId: o.jobId, args: ['-i', o.input, '-vn', '-sn', ...loudnormArgs(o.normalizeAudio), ...metadataArgs(o.stripMetadata), ...audioCodecArgsForExt(ext, '192k'), tmp], duration, onProgress: o.onProgress
    }))
    return { output: o.output }
  }
  if (o.mode === 'audio-copy') {
    if (info && !info.audio) throw new JobFailedError({ code: 'FORMAT', message: '该文件没有音频流，无法提取音频' })
    await withTempOutput(o.output, (tmp) => runFfmpeg({
      jobId: o.jobId, args: ['-i', o.input, '-map', '0:a:0?', '-vn', '-sn', '-c:a', 'copy', ...metadataArgs(o.stripMetadata), tmp], duration, onProgress: o.onProgress
    }))
    return { output: o.output }
  }
  if (info && !info.video) throw new JobFailedError({ code: 'FORMAT', message: '该文件没有视频流，无法导出无声视频' })
  await withTempOutput(o.output, (tmp) => runFfmpeg({
    jobId: o.jobId, args: ['-i', o.input, '-map', '0:V:0', '-an', '-sn', '-c:v', 'copy', ...metadataArgs(o.stripMetadata), ...containerArgs(o.output), tmp], duration, onProgress: o.onProgress
  }))
  return { output: o.output }
}

export type TrimMode = 'fast' | 'precise'

export interface TrimOpts extends BaseOpts {
  start: number
  end: number
  mode: TrimMode
  hwEncoder?: string | null
}

/** 精准模式下视频的输出容器（libx264 不能写进 webm 等容器）。 */
export function preciseTrimExt(input: string, audioOnly: boolean): string {
  const e = path.extname(input).toLowerCase()
  if (audioOnly) return ['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus'].includes(e) ? e : '.mp3'
  return ['.mp4', '.mkv', '.mov', '.m4v'].includes(e) ? e : '.mp4'
}

export async function trimMedia(o: TrimOpts): Promise<MediaOpResult> {
  const start = Math.max(0, o.start)
  const dur = Math.max(0.05, o.end - start)
  if (!(o.end > start)) throw new JobFailedError({ code: 'UNKNOWN', message: '结束时间必须大于开始时间' })
  const ss = start.toFixed(3)
  const t = dur.toFixed(3)
  if (o.mode === 'fast') {
    await withTempOutput(o.output, (tmp) => runFfmpeg({
      jobId: o.jobId,
      args: ['-ss', ss, '-i', o.input, '-t', t, '-map', '0:v?', '-map', '0:a?', '-c', 'copy', '-avoid_negative_ts', 'make_zero', ...metadataArgs(o.stripMetadata), ...containerArgs(o.output), tmp],
      duration: dur, onProgress: o.onProgress
    }))
    return { output: o.output }
  }
  const info = o.info !== undefined ? o.info : await safeProbe(o.input)
  if (isAudioOnly(info, o.input)) {
    await withTempOutput(o.output, (tmp) => runFfmpeg({
      jobId: o.jobId,
      args: ['-ss', ss, '-i', o.input, '-t', t, '-vn', ...loudnormArgs(o.normalizeAudio), ...metadataArgs(o.stripMetadata), ...audioCodecArgsForExt(path.extname(o.output), '192k'), tmp],
      duration: dur, onProgress: o.onProgress
    }))
    return { output: o.output }
  }
  // 精准模式：-ss 放在 -i 之前并重新编码，ffmpeg 默认 accurate_seek，可做到帧级精确且比输出端 seek 快得多
  const r = await withTempOutput(o.output, (tmp) => runWithFallback(
    { ...o, info }, dur, o.hwEncoder ?? null, 'high', 18, 'medium',
    (spec) => [...spec.preInput, '-ss', ss, '-accurate_seek', '-i', o.input, '-t', t, '-map', '0:V:0', '-map', '0:a?', ...videoArgs(spec), '-c:a', 'aac', '-b:a', '192k', ...loudnormArgs(o.normalizeAudio), ...metadataArgs(o.stripMetadata), ...containerArgs(o.output)],
    tmp
  ))
  return { output: o.output, ...r }
}

export type ConcatMode = 'auto' | 'copy' | 'transcode'

export interface ConcatOpts {
  jobId: string
  inputs: string[]
  output: string
  mode?: ConcatMode
  hwEncoder?: string | null
  stripMetadata?: boolean
  normalizeAudio?: boolean
  onProgress?: ProgressCallback
}

/**
 * 多视频/多音频拼接合并。
 * 支持：
 * 1. 同规格极速流复制秒级无损合并 (基于 FFmpeg concat demuxer)；
 * 2. 异规格智能重编码合流 (统一分辨率加黑边、声道采样率标准化对齐)。
 */
export async function concatMedia(o: ConcatOpts): Promise<MediaOpResult> {
  if (!Array.isArray(o.inputs) || o.inputs.length < 2) {
    throw new JobFailedError({ code: 'FORMAT', message: '视频拼接至少需要提供 2 个文件' })
  }
  for (const input of o.inputs) {
    if (!fs.existsSync(input)) {
      throw new JobFailedError({ code: 'NOT_FOUND', message: `拼接源文件不存在：${input}` })
    }
  }

  const probes = await Promise.all(o.inputs.map(safeProbe))
  const totalDuration = probes.reduce((acc, p) => acc + (p?.duration || 0), 0)

  // 检查是否具备同规格极速流复制条件
  const first = probes[0]
  const allHaveVideo = probes.every(p => Boolean(p?.video))
  const allHaveAudio = probes.every(p => Boolean(p?.audio))
  const sameVideo = allHaveVideo && probes.every(p =>
    p?.video?.codec === first?.video?.codec &&
    p?.video?.width === first?.video?.width &&
    p?.video?.height === first?.video?.height
  )
  const sameAudio = (allHaveAudio && probes.every(p => p?.audio?.codec === first?.audio?.codec)) || probes.every(p => !p?.audio)

  const mode = o.mode || 'auto'
  const canCopy = mode === 'copy' || (mode === 'auto' && sameVideo && sameAudio)

  if (canCopy) {
    // 极速流复制拼接 (Concat Demuxer)
    const tmpDir = path.dirname(o.output)
    const listFile = path.join(tmpDir, `.concat_${o.jobId}_${Date.now()}.txt`)
    const listContent = o.inputs.map(p => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join('\n')
    fs.writeFileSync(listFile, listContent, 'utf8')
    try {
      await withTempOutput(o.output, (tmp) => runFfmpeg({
        jobId: o.jobId,
        args: [
          '-f', 'concat',
          '-safe', '0',
          '-i', listFile,
          '-c', 'copy',
          ...metadataArgs(o.stripMetadata),
          ...containerArgs(o.output),
          tmp
        ],
        duration: totalDuration,
        onProgress: o.onProgress
      }))
      return { output: o.output, encoder: 'copy', notice: '极速流复制无损合并完成' }
    } finally {
      try { fs.rmSync(listFile, { force: true }) } catch { /* ignore */ }
    }
  }

  // 智能重编码合流 (Concat Filter)
  // 以第一个有效视频的宽高为标准，若无则默认 1920x1080
  const targetW = first?.video?.width || 1920
  const targetH = first?.video?.height || 1080
  const n = o.inputs.length

  const inputArgs: string[] = []
  const filterChains: string[] = []
  const concatInputs: string[] = []

  for (let i = 0; i < n; i++) {
    inputArgs.push('-i', o.inputs[i])
    // 画面统一等比缩放并居中加黑边至 targetW x targetH，强制统一帧率 30fps
    filterChains.push(
      `[${i}:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
    )
    if (probes[i]?.audio) {
      // 统一音频格式为 44100Hz 双声道
      filterChains.push(`[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`)
    } else {
      // 若原视频无声，补全静音音轨
      const dur = probes[i]?.duration || 5
      filterChains.push(`aevalsrc=0:d=${dur.toFixed(2)}:s=44100:c=stereo[a${i}]`)
    }
    concatInputs.push(`[v${i}][a${i}]`)
  }

  let concatFilter = `${filterChains.join('; ')}; ${concatInputs.join('')}concat=n=${n}:v=1:a=1[outv]`
  if (o.normalizeAudio) {
    concatFilter += `[concat_a]; [concat_a]loudnorm=I=-16:TP=-1.5:LRA=11[outa]`
  } else {
    concatFilter += `[outa]`
  }

  // 视频编码器：优先使用硬件加速，否则 libx264
  let videoCodecArgs = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p']
  let usedEncoder = 'libx264'
  if (o.hwEncoder) {
    const hw = hwEncoderSpec(o.hwEncoder, 3500)
    videoCodecArgs = hw.args
    usedEncoder = o.hwEncoder
  }

  await withTempOutput(o.output, (tmp) => runFfmpeg({
    jobId: o.jobId,
    args: [
      ...inputArgs,
      '-filter_complex', concatFilter,
      '-map', '[outv]',
      '-map', '[outa]',
      ...videoCodecArgs,
      '-c:a', 'aac',
      '-b:a', '192k',
      ...metadataArgs(o.stripMetadata),
      ...containerArgs(o.output),
      tmp
    ],
    duration: totalDuration,
    onProgress: o.onProgress
  }))

  return { output: o.output, encoder: usedEncoder, notice: `智能重编码合流完成 (${n} 个片段拼接)` }
}

/**
 * 提取文件（视频抽取第 1 秒画面，图片直接返回）的图像路径，用于画质对比。
 */
export async function extractFrame(filePath: string, timestampSec = 1): Promise<string> {
  const ext = path.extname(filePath).toLowerCase()
  if (['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'].includes(ext)) {
    return filePath
  }
  const tmpDir = os.tmpdir()
  const outPath = path.join(tmpDir, `compare_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`)
  await runFfmpeg({
    jobId: `frame_${Date.now()}`,
    args: ['-ss', Math.max(0, timestampSec).toFixed(3), '-i', filePath, '-frames:v', '1', '-q:v', '2', outPath],
    duration: 0
  })
  return outPath
}
