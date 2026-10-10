import { spawn } from 'child_process'
import fs from 'fs'
import { getFfprobePath } from './binaries'
import { JobFailedError, mapError } from './errors'

export interface MediaInfo {
  format: string
  duration: number
  size: number
  bitrate: number
  video?: { codec: string; width: number; height: number; fps: number; bitrate: number }
  audio?: { codec: string; sampleRate: number; channels: number; bitrate: number }
}

export function probeMedia(filePath: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      reject(new JobFailedError(mapError(`${filePath}: No such file or directory`)))
      return
    }
    const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath]
    const proc = spawn(getFfprobePath(), args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('error', (err) => reject(new JobFailedError(mapError(err))))
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new JobFailedError(mapError(stderr || 'Invalid data found when processing input', { exitCode: code })))
        return
      }
      try {
        const data = JSON.parse(stdout)
        const format = data.format || {}
        const streams: Record<string, unknown>[] = data.streams || []
        const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition as { attached_pic?: number } | undefined)?.attached_pic) as Record<string, any> | undefined
        const a = streams.find((s) => s.codec_type === 'audio') as Record<string, any> | undefined
        let duration = parseFloat(format.duration)
        if (!Number.isFinite(duration) || duration <= 0) {
          const sd = streams.map((s) => parseFloat(String(s.duration))).filter((n) => Number.isFinite(n) && n > 0)
          duration = sd.length ? Math.max(...sd) : 0
        }
        const info: MediaInfo = {
          format: (format.format_name || '').split(',')[0] || 'unknown',
          duration,
          size: parseInt(format.size, 10) || safeSize(filePath),
          bitrate: parseInt(format.bit_rate, 10) || 0
        }
        if (v) {
          const [n, d] = String(v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v.r_frame_rate || '0/1').split('/').map(Number)
          const fps = d ? n / d : 0
          info.video = {
            codec: v.codec_name || '',
            width: v.width || 0,
            height: v.height || 0,
            fps: Math.round(fps * 100) / 100,
            bitrate: parseInt(v.bit_rate, 10) || 0
          }
        }
        if (a) {
          info.audio = {
            codec: a.codec_name || '',
            sampleRate: parseInt(a.sample_rate, 10) || 0,
            channels: a.channels || 0,
            bitrate: parseInt(a.bit_rate, 10) || 0
          }
        }
        resolve(info)
      } catch (e) {
        reject(new JobFailedError(mapError(e)))
      }
    })
  })
}

export function safeSize(p: string): number {
  try { return fs.statSync(p).size } catch { return 0 }
}
