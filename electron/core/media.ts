import path from 'path'
import fs from 'fs'
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

export interface CompressOpts extends BaseOpts {
  preset: QualityPreset
  customCrf?: number
  customAudioBitrate?: string
  hwEncoder?: string | null
}

export async function compressMedia(o: CompressOpts): Promise<MediaOpResult> {
  const info = o.info !== undefined ? o.info : await safeProbe(o.input)
  const duration = info?.duration || 0
  if (isAudioOnly(info, o.input)) {
    const bitrate = o.customAudioBitrate || AUDIO_PRESETS[o.preset]
    const ext = path.extname(o.output)
    await withTempOutput(o.output, (tmp) => runFfmpeg({
      jobId: o.jobId,
      args: ['-i', o.input, '-vn', '-map_metadata', '0', ...audioCodecArgsForExt(ext, bitrate), tmp],
      duration, onProgress: o.onProgress
    }))
    return { output: o.output }
  }
  const p = VIDEO_PRESETS[o.preset]
  const crf = o.customCrf ?? p.crf
  const audioBr = o.customAudioBitrate || p.audioBitrate
  const quality = o.customCrf !== undefined ? { crf: o.customCrf } : o.preset
  const r = await withTempOutput(o.output, (tmp) => runWithFallback(
    { ...o, info }, duration, o.hwEncoder ?? null, quality, crf, p.preset,
    (spec) => [...spec.preInput, '-i', o.input, '-map', '0:V:0', '-map', '0:a?', ...videoArgs(spec), '-c:a', 'aac', '-b:a', audioBr, ...containerArgs(o.output)],
    tmp
  ))
  return { output: o.output, ...r }
}

export const CONVERT_FORMATS = ['mp4', 'mkv', 'webm', 'mp3', 'aac', 'wav'] as const
export type ConvertFormat = (typeof CONVERT_FORMATS)[number]

export interface ConvertOpts extends BaseOpts {
  format: string
  hwEncoder?: string | null
}

export async function convertFormat(o: ConvertOpts): Promise<MediaOpResult> {
  const info = o.info !== undefined ? o.info : await safeProbe(o.input)
  const duration = info?.duration || 0
  const f = o.format.toLowerCase()
  if (f === 'mp4' || f === 'mkv') {
    if (info && !info.video) throw new JobFailedError({ code: 'FORMAT', message: '该文件没有视频流，无法转换为视频格式（请选择音频格式）' })
    const r = await withTempOutput(o.output, (tmp) => runWithFallback(
      { ...o, info }, duration, o.hwEncoder ?? null, 'balanced', 23, 'medium',
      (spec) => [...spec.preInput, '-i', o.input, '-map', '0:V:0', '-map', '0:a?', ...videoArgs(spec), '-c:a', 'aac', '-b:a', '192k', ...(f === 'mp4' ? ['-movflags', '+faststart'] : [])],
      tmp
    ))
    return { output: o.output, ...r }
  }
  let args: string[]
  switch (f) {
    case 'webm':
      if (info && !info.video) throw new JobFailedError({ code: 'FORMAT', message: '该文件没有视频流，无法转换为视频格式（请选择音频格式）' })
      args = ['-i', o.input, '-map', '0:V:0', '-map', '0:a?', '-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '128k']
      break
    case 'mp3': args = ['-i', o.input, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k']; break
    case 'aac': args = ['-i', o.input, '-vn', '-c:a', 'aac', '-b:a', '192k']; break
    case 'wav': args = ['-i', o.input, '-vn', '-c:a', 'pcm_s16le']; break
    default: args = ['-i', o.input, '-c', 'copy']
  }
  await withTempOutput(o.output, (tmp) => runFfmpeg({ jobId: o.jobId, args: [...args, tmp], duration, onProgress: o.onProgress }))
  return { output: o.output, encoder: f === 'webm' ? 'libvpx-vp9' : undefined }
}

export interface SeparateOpts extends BaseOpts {
  mode: 'audio' | 'video'
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
      jobId: o.jobId, args: ['-i', o.input, '-vn', '-sn', ...audioCodecArgsForExt(ext, '192k'), tmp], duration, onProgress: o.onProgress
    }))
    return { output: o.output }
  }
  if (info && !info.video) throw new JobFailedError({ code: 'FORMAT', message: '该文件没有视频流，无法导出无声视频' })
  await withTempOutput(o.output, (tmp) => runFfmpeg({
    jobId: o.jobId, args: ['-i', o.input, '-map', '0:V:0', '-an', '-sn', '-c:v', 'copy', ...containerArgs(o.output), tmp], duration, onProgress: o.onProgress
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
      args: ['-ss', ss, '-i', o.input, '-t', t, '-map', '0:v?', '-map', '0:a?', '-c', 'copy', '-avoid_negative_ts', 'make_zero', ...containerArgs(o.output), tmp],
      duration: dur, onProgress: o.onProgress
    }))
    return { output: o.output }
  }
  const info = o.info !== undefined ? o.info : await safeProbe(o.input)
  if (isAudioOnly(info, o.input)) {
    await withTempOutput(o.output, (tmp) => runFfmpeg({
      jobId: o.jobId,
      args: ['-ss', ss, '-i', o.input, '-t', t, '-vn', ...audioCodecArgsForExt(path.extname(o.output), '192k'), tmp],
      duration: dur, onProgress: o.onProgress
    }))
    return { output: o.output }
  }
  // 精准模式：-ss 放在 -i 之前并重新编码，ffmpeg 默认 accurate_seek，可做到帧级精确且比输出端 seek 快得多
  const r = await withTempOutput(o.output, (tmp) => runWithFallback(
    { ...o, info }, dur, o.hwEncoder ?? null, 'high', 18, 'medium',
    (spec) => [...spec.preInput, '-ss', ss, '-accurate_seek', '-i', o.input, '-t', t, '-map', '0:V:0', '-map', '0:a?', ...videoArgs(spec), '-c:a', 'aac', '-b:a', '192k', ...containerArgs(o.output)],
    tmp
  ))
  return { output: o.output, ...r }
}
