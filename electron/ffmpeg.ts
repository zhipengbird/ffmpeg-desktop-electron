import path from 'path'
import fs from 'fs'
import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'

let ffmpegPath: string
let ffprobePath: string

/** Binaries cannot run from inside asar; rewrite to unpacked path. */
function unpackAsarPath(p: string): string {
  if (p && p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
    return p.replace('app.asar', 'app.asar.unpacked')
  }
  return p
}

function resolveBinary(pkgName: string, fallbackNames: string[]): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(pkgName)
    let p = typeof mod === 'string' ? mod : mod.path
    if (p) {
      p = unpackAsarPath(p)
      if (fs.existsSync(p)) return p
    }
  } catch {
    /* continue */
  }
  const candidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', pkgName),
    path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'node_modules', pkgName),
    path.join(__dirname, '..', 'node_modules', pkgName)
  ]
  for (const base of candidates) {
    for (const name of fallbackNames) {
      const full = path.join(base, name)
      if (fs.existsSync(full)) return full
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(path.join(base, 'index.js'))
      let p = typeof mod === 'string' ? mod : mod?.path
      if (p) {
        p = unpackAsarPath(p)
        if (fs.existsSync(p)) return p
      }
    } catch {
      /* continue */
    }
  }
  return fallbackNames[0].includes('ffprobe') ? 'ffprobe' : 'ffmpeg'
}

export function initFfmpegPaths(): void {
  const isWin = process.platform === 'win32'
  ffmpegPath = resolveBinary('ffmpeg-static', [isWin ? 'ffmpeg.exe' : 'ffmpeg'])

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffprobeStatic = require('ffprobe-static')
    let p = ffprobeStatic.path as string
    p = unpackAsarPath(p)
    if (fs.existsSync(p)) {
      ffprobePath = p
    } else {
      ffprobePath = resolveBinary('ffprobe-static', [
        path.join(process.platform, process.arch, isWin ? 'ffprobe.exe' : 'ffprobe')
      ])
    }
  } catch {
    ffprobePath = resolveBinary('ffprobe-static', [
      path.join(process.platform, process.arch, isWin ? 'ffprobe.exe' : 'ffprobe')
    ])
  }

  // Ensure executable bit on unix
  for (const bin of [ffmpegPath, ffprobePath]) {
    try {
      if (bin && fs.existsSync(bin) && process.platform !== 'win32') {
        fs.chmodSync(bin, 0o755)
      }
    } catch { /* ignore */ }
  }

  console.log('[ffmpeg] path:', ffmpegPath, 'exists=', fs.existsSync(ffmpegPath))
  console.log('[ffprobe] path:', ffprobePath, 'exists=', fs.existsSync(ffprobePath))
}

export function getFfmpegPath(): string {
  return ffmpegPath
}

export function getFfprobePath(): string {
  return ffprobePath
}

export interface MediaInfo {
  format: string
  duration: number
  size: number
  bitrate: number
  video?: {
    codec: string
    width: number
    height: number
    fps: number
    bitrate: number
  }
  audio?: {
    codec: string
    sampleRate: number
    channels: number
    bitrate: number
  }
}

export function probeMedia(filePath: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ]
    const proc = spawn(ffprobePath, args)
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `ffprobe 退出码 ${code}`))
        return
      }
      try {
        const data = JSON.parse(stdout)
        const format = data.format || {}
        const streams = data.streams || []
        const videoStream = streams.find((s: { codec_type: string }) => s.codec_type === 'video')
        const audioStream = streams.find((s: { codec_type: string }) => s.codec_type === 'audio')
        const info: MediaInfo = {
          format: (format.format_name || '').split(',')[0] || 'unknown',
          duration: parseFloat(format.duration) || 0,
          size: parseInt(format.size, 10) || 0,
          bitrate: parseInt(format.bit_rate, 10) || 0
        }
        if (videoStream) {
          const fpsParts = (videoStream.r_frame_rate || '0/1').split('/')
          const fps = fpsParts.length === 2 ? parseFloat(fpsParts[0]) / parseFloat(fpsParts[1]) : 0
          info.video = {
            codec: videoStream.codec_name || '',
            width: videoStream.width || 0,
            height: videoStream.height || 0,
            fps: Math.round(fps * 100) / 100,
            bitrate: parseInt(videoStream.bit_rate, 10) || 0
          }
        }
        if (audioStream) {
          info.audio = {
            codec: audioStream.codec_name || '',
            sampleRate: parseInt(audioStream.sample_rate, 10) || 0,
            channels: audioStream.channels || 0,
            bitrate: parseInt(audioStream.bit_rate, 10) || 0
          }
        }
        resolve(info)
      } catch (e) {
        reject(e)
      }
    })
    proc.on('error', reject)
  })
}

export type ProgressCallback = (percent: number, timemark?: string) => void

export interface JobHandle {
  cancel: () => void
  promise: Promise<string>
}

const activeJobs = new Map<string, ChildProcess>()

export function cancelJob(jobId: string): boolean {
  const proc = activeJobs.get(jobId)
  if (proc) {
    proc.kill('SIGTERM')
    activeJobs.delete(jobId)
    return true
  }
  return false
}

export function cancelAllJobs(): void {
  for (const [, proc] of activeJobs) {
    try { proc.kill('SIGTERM') } catch { /* ignore */ }
  }
  activeJobs.clear()
}

function runFfmpeg(
  jobId: string,
  args: string[],
  durationSec: number,
  onProgress?: ProgressCallback
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-y', ...args])
    activeJobs.set(jobId, proc)
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      const text = d.toString()
      stderr += text
      if (onProgress && durationSec > 0) {
        const match = text.match(/time=(\d+):(\d+):(\d+\.\d+)/)
        if (match) {
          const hours = parseInt(match[1], 10)
          const mins = parseInt(match[2], 10)
          const secs = parseFloat(match[3])
          const current = hours * 3600 + mins * 60 + secs
          const percent = Math.min(99, Math.round((current / durationSec) * 100))
          onProgress(percent, match[0].replace('time=', ''))
        }
      }
    })
    proc.on('close', (code) => {
      activeJobs.delete(jobId)
      if (code === 0) {
        onProgress?.(100)
        resolve(args[args.length - 1])
      } else if (code === null) {
        reject(new Error('任务已取消'))
      } else {
        const lines = stderr.trim().split('\n')
        const lastLines = lines.slice(-8).join('\n')
        reject(new Error(lastLines || `FFmpeg 退出码 ${code}`))
      }
    })
    proc.on('error', (err) => {
      activeJobs.delete(jobId)
      reject(err)
    })
  })
}

export type CompressPreset = 'high' | 'balanced' | 'small'

const VIDEO_PRESETS: Record<CompressPreset, { crf: number; preset: string; audioBitrate: string }> = {
  high: { crf: 18, preset: 'slow', audioBitrate: '192k' },
  balanced: { crf: 23, preset: 'medium', audioBitrate: '128k' },
  small: { crf: 28, preset: 'fast', audioBitrate: '96k' }
}

const AUDIO_PRESETS: Record<CompressPreset, string> = {
  high: '256k',
  balanced: '128k',
  small: '64k'
}

export interface CompressOptions {
  jobId: string
  input: string
  output: string
  preset: CompressPreset
  customCrf?: number
  customBitrate?: string
  isAudioOnly?: boolean
  duration?: number
  onProgress?: ProgressCallback
}

export async function compressMedia(opts: CompressOptions): Promise<string> {
  const { jobId, input, output, preset, customCrf, customBitrate, isAudioOnly, onProgress } = opts
  let duration = opts.duration || 0
  if (!duration) {
    try {
      const info = await probeMedia(input)
      duration = info.duration
    } catch { /* ignore */ }
  }

  if (isAudioOnly) {
    const bitrate = customBitrate || AUDIO_PRESETS[preset]
    const ext = path.extname(output).toLowerCase()
    const codec = ext === '.mp3' ? 'libmp3lame' : ext === '.aac' || ext === '.m4a' ? 'aac' : 'libmp3lame'
    return runFfmpeg(jobId, [
      '-i', input,
      '-vn',
      '-c:a', codec,
      '-b:a', bitrate,
      output
    ], duration, onProgress)
  }

  const p = VIDEO_PRESETS[preset]
  const crf = customCrf ?? p.crf
  const audioBr = customBitrate || p.audioBitrate
  return runFfmpeg(jobId, [
    '-i', input,
    '-c:v', 'libx264',
    '-crf', String(crf),
    '-preset', p.preset,
    '-c:a', 'aac',
    '-b:a', audioBr,
    '-movflags', '+faststart',
    output
  ], duration, onProgress)
}

export interface ConvertOptions {
  jobId: string
  input: string
  output: string
  format: string
  duration?: number
  onProgress?: ProgressCallback
}

export async function convertFormat(opts: ConvertOptions): Promise<string> {
  const { jobId, input, output, format, onProgress } = opts
  let duration = opts.duration || 0
  if (!duration) {
    try {
      const info = await probeMedia(input)
      duration = info.duration
    } catch { /* ignore */ }
  }

  const args: string[] = ['-i', input]
  switch (format) {
    case 'mp4':
      args.push('-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart')
      break
    case 'mkv':
      args.push('-c:v', 'libx264', '-c:a', 'aac')
      break
    case 'webm':
      args.push('-c:v', 'libvpx-vp9', '-c:a', 'libopus', '-b:v', '1M')
      break
    case 'mp3':
      args.push('-vn', '-c:a', 'libmp3lame', '-b:a', '192k')
      break
    case 'aac':
      args.push('-vn', '-c:a', 'aac', '-b:a', '192k')
      break
    case 'wav':
      args.push('-vn', '-c:a', 'pcm_s16le')
      break
    default:
      args.push('-c', 'copy')
  }
  args.push(output)
  return runFfmpeg(jobId, args, duration, onProgress)
}

export interface SeparateOptions {
  jobId: string
  input: string
  output: string
  mode: 'audio' | 'video'
  duration?: number
  onProgress?: ProgressCallback
}

export async function separateStreams(opts: SeparateOptions): Promise<string> {
  const { jobId, input, output, mode, onProgress } = opts
  let duration = opts.duration || 0
  if (!duration) {
    try {
      const info = await probeMedia(input)
      duration = info.duration
    } catch { /* ignore */ }
  }

  if (mode === 'audio') {
    const ext = path.extname(output).toLowerCase()
    const codec = ext === '.wav' ? 'pcm_s16le' : ext === '.aac' || ext === '.m4a' ? 'aac' : 'libmp3lame'
    const bitrateArgs = codec === 'pcm_s16le' ? [] : ['-b:a', '192k']
    return runFfmpeg(jobId, [
      '-i', input, '-vn', '-c:a', codec, ...bitrateArgs, output
    ], duration, onProgress)
  }

  return runFfmpeg(jobId, [
    '-i', input, '-an', '-c:v', 'copy', output
  ], duration, onProgress)
}

export interface TrimOptions {
  jobId: string
  input: string
  output: string
  start: number
  end: number
  onProgress?: ProgressCallback
}

export async function trimMedia(opts: TrimOptions): Promise<string> {
  const { jobId, input, output, start, end, onProgress } = opts
  const duration = Math.max(0.1, end - start)
  return runFfmpeg(jobId, [
    '-ss', String(start),
    '-i', input,
    '-t', String(duration),
    '-c', 'copy',
    '-avoid_negative_ts', 'make_zero',
    output
  ], duration, onProgress)
}

export function defaultOutputPath(input: string, suffix: string, ext?: string): string {
  const dir = path.dirname(input)
  const base = path.basename(input, path.extname(input))
  const extension = ext || path.extname(input)
  return path.join(dir, `${base}_${suffix}${extension}`)
}
