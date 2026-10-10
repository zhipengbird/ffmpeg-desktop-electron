import path from 'path'
import fs from 'fs'
import type { EncoderInfo, JobSuccess, QualityPreset, QueueItem, Settings } from '../../shared/types'
import { cancelJob } from './runner'
import { cancelledError, JobFailedError, mapError } from './errors'
import { decideOutputPath, PathReservations } from './naming'
import { safeSize } from './probe'
import {
  audioTargetFor, compressMedia, concatMedia, convertFormat, isAudioOnly, preciseTrimExt, rawAudioExt, safeProbe,
  separateStreams, silentVideoExt, trimMedia, type ConcatMode, type MediaOpResult, type SeparateMode, type TrimMode
} from './media'
import { compressImage, imageExt, resolveImageFormat, type ImageCompressOptions, type ImageFormatChoice } from './image'
import { chooseHwEncoder } from './hwaccel'
import type { TaskContext } from './queue'

export interface ImageEngineResult { notice?: string }

export interface TaskEnv {
  getSettings: () => Settings
  getEncoderInfo: () => EncoderInfo | null
  reservations: PathReservations
  /** 可替换的图片引擎（主进程在 Linux 上使用独立进程 + FFmpeg 回退）；默认直接调用 sharp */
  compressImage?: (opts: ImageCompressOptions & { jobId: string }) => Promise<ImageEngineResult | void>
}

export interface CompressParams {
  preset: QualityPreset
  customCrf?: number
  customAudioBitrate?: string
  targetSizeMB?: number
  normalizeAudio?: boolean
}
export interface ImageParams { preset: QualityPreset; format: ImageFormatChoice; customQuality?: number }
export interface SeparateParams { mode: SeparateMode; normalizeAudio?: boolean }
export interface ConvertParams {
  format: string
  gifFps?: number
  gifWidth?: number
  normalizeAudio?: boolean
}
export interface TrimParams { start: number; end: number; mode: TrimMode; normalizeAudio?: boolean }
export interface MergeParams { mode?: ConcatMode; normalizeAudio?: boolean }

export const PRESET_LABEL: Record<QualityPreset, string> = { high: '高质量', balanced: '平衡', small: '小体积' }

function hwFor(env: TaskEnv): string | null {
  const s = env.getSettings()
  return chooseHwEncoder(env.getEncoderInfo(), s.hwAccel, s.hwEncoder)
}

/** 预留输出路径→执行→释放；“跳过”时直接返回 skipped。 */
async function withOutput(
  input: string,
  suffix: string,
  ext: string,
  env: TaskEnv,
  ctx: Pick<TaskContext, 'signal'>,
  run: (output: string) => Promise<MediaOpResult | string>
): Promise<JobSuccess> {
  if (!fs.existsSync(input)) throw new JobFailedError(mapError(`${input}: No such file or directory`))
  const s = env.getSettings()
  if (s.outputMode === 'custom' && s.outputDir && !fs.existsSync(s.outputDir)) {
    throw new JobFailedError(mapError(`输出目录 ${s.outputDir}: No such file or directory`))
  }
  const inputSize = safeSize(input)
  const decision = decideOutputPath(input, suffix, ext, s, env.reservations)
  if (decision.skip) {
    return { ok: true, skipped: true, output: decision.path, inputSize, outputSize: safeSize(decision.path) }
  }
  try {
    if (ctx.signal.aborted) throw cancelledError()
    const r = await run(decision.path)
    if (ctx.signal.aborted) {
      throw cancelledError()
    }
    const res = typeof r === 'string' ? { output: r } : (r || { output: decision.path })
    const finalOut = res?.output || decision.path
    return {
      ok: true,
      output: finalOut,
      inputSize,
      outputSize: safeSize(finalOut),
      notice: res?.notice,
      encoder: res?.encoder
    }
  } finally {
    env.reservations.release(decision.path)
  }
}

function linkAbort(ctx: TaskContext): void {
  ctx.signal.addEventListener('abort', () => cancelJob(ctx.jobId), { once: true })
}

export async function compressTask(item: Readonly<QueueItem>, p: CompressParams, ctx: TaskContext, env: TaskEnv): Promise<JobSuccess> {
  linkAbort(ctx)
  const s = env.getSettings()
  const info = await safeProbe(item.input)
  const audio = isAudioOnly(info, item.input)
  const ext = audio ? audioTargetFor(path.extname(item.input)).ext : '.mp4'
  const isTargetSize = typeof p.targetSizeMB === 'number' && p.targetSizeMB > 0
  const suffix = isTargetSize
    ? `压缩_目标${p.targetSizeMB}MB`
    : `压缩_${p.customCrf !== undefined ? `crf${p.customCrf}` : PRESET_LABEL[p.preset]}`
  return withOutput(item.input, suffix, ext, env, ctx, (output) => compressMedia({
    jobId: ctx.jobId, input: item.input, output, info, preset: p.preset,
    customCrf: audio ? undefined : p.customCrf, customAudioBitrate: p.customAudioBitrate,
    targetSizeMB: p.targetSizeMB,
    hwEncoder: audio ? null : hwFor(env),
    stripMetadata: s.stripMetadata,
    normalizeAudio: p.normalizeAudio,
    onProgress: ctx.onProgress
  }))
}

export async function convertTask(item: Readonly<QueueItem>, p: ConvertParams, ctx: TaskContext, env: TaskEnv): Promise<JobSuccess> {
  linkAbort(ctx)
  const s = env.getSettings()
  const info = await safeProbe(item.input)
  const f = p.format.toLowerCase()
  return withOutput(item.input, '转换', `.${f}`, env, ctx, (output) => convertFormat({
    jobId: ctx.jobId, input: item.input, output, info, format: f,
    gifFps: p.gifFps, gifWidth: p.gifWidth,
    hwEncoder: hwFor(env),
    stripMetadata: s.stripMetadata,
    normalizeAudio: p.normalizeAudio,
    onProgress: ctx.onProgress
  }))
}

export async function separateTask(item: Readonly<QueueItem>, p: SeparateParams, ctx: TaskContext, env: TaskEnv): Promise<JobSuccess> {
  linkAbort(ctx)
  const s = env.getSettings()
  const info = await safeProbe(item.input)
  let ext: string
  let suffix: string
  if (p.mode === 'audio') {
    ext = '.mp3'
    suffix = '音频'
  } else if (p.mode === 'audio-copy') {
    ext = rawAudioExt(info?.audio?.codec)
    suffix = '原音频'
  } else {
    ext = silentVideoExt(item.input)
    suffix = '无声视频'
  }
  return withOutput(item.input, suffix, ext, env, ctx, (output) => separateStreams({
    jobId: ctx.jobId, input: item.input, output, info, mode: p.mode,
    stripMetadata: s.stripMetadata,
    normalizeAudio: p.normalizeAudio,
    onProgress: ctx.onProgress
  }))
}

export async function imageTask(item: Readonly<QueueItem>, p: ImageParams, ctx: TaskContext, env: TaskEnv): Promise<JobSuccess> {
  const s = env.getSettings()
  const format = resolveImageFormat(item.input, p.format)
  const suffix = `压缩_${p.customQuality !== undefined ? `q${p.customQuality}` : PRESET_LABEL[p.preset]}`
  ctx.onProgress(null)
  linkAbort(ctx)
  return withOutput(item.input, suffix, imageExt(format), env, ctx, async (output) => {
    const opts: ImageCompressOptions & { jobId: string } = {
      jobId: ctx.jobId, input: item.input, output, preset: p.preset,
      customQuality: p.customQuality, format, stripMetadata: s.stripMetadata
    }
    const r = env.compressImage ? await env.compressImage(opts) : await compressImage(opts)
    if (ctx.signal.aborted) {
      // sharp 无法中途中止：完成后如已取消则删除结果
      try { fs.rmSync(output, { force: true }) } catch { /* ignore */ }
    }
    return { output, notice: r && typeof r === 'object' ? r.notice : undefined }
  })
}

/** 单文件裁剪（不入队列）。 */
export async function trimTask(
  input: string, p: TrimParams, ctx: TaskContext, env: TaskEnv
): Promise<JobSuccess> {
  linkAbort(ctx)
  const s = env.getSettings()
  const info = p.mode === 'precise' ? await safeProbe(input) : undefined
  const ext = p.mode === 'precise' ? preciseTrimExt(input, isAudioOnly(info ?? null, input)) : path.extname(input)
  const suffix = p.mode === 'precise' ? '截取_精准' : '截取'
  return withOutput(input, suffix, ext, env, ctx, (output) => trimMedia({
    jobId: ctx.jobId, input, output, info, start: p.start, end: p.end, mode: p.mode,
    hwEncoder: p.mode === 'precise' ? hwFor(env) : null,
    stripMetadata: s.stripMetadata,
    normalizeAudio: p.normalizeAudio,
    onProgress: ctx.onProgress
  }))
}

/**
 * 多视频拼接合并任务。
 */
export async function mergeTask(
  inputs: string[],
  p: MergeParams,
  ctx: TaskContext,
  env: TaskEnv
): Promise<JobSuccess> {
  if (!inputs.length) throw new JobFailedError(mapError('拼接输入文件列表为空'))
  linkAbort(ctx)
  const s = env.getSettings()
  const first = inputs[0]
  const ext = path.extname(first) || '.mp4'
  const suffix = p.mode === 'copy' ? '合并_无损' : '合并'
  return withOutput(first, suffix, ext, env, ctx, (output) => concatMedia({
    jobId: ctx.jobId,
    inputs,
    output,
    mode: p.mode,
    hwEncoder: hwFor(env),
    stripMetadata: s.stripMetadata,
    normalizeAudio: p.normalizeAudio,
    onProgress: ctx.onProgress
  }))
}
