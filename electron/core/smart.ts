import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import { getFfmpegPath } from './binaries'
import { runFfmpeg, type ProgressCallback } from './runner'
import { safeProbe } from './media'

export interface SilenceInterval {
  start: number
  end: number
  duration: number
}

export interface SpeechSegment {
  start: number
  end: number
  duration: number
}

export interface SilenceDetectResult {
  totalDuration: number
  silenceCount: number
  totalSilenceDuration: number
  estimatedNewDuration: number
  savedPercent: number
  silences: SilenceInterval[]
  speechSegments: SpeechSegment[]
}

/**
 * 极速探测音频或视频中的静音空白片段。
 * 运行速度通常为真实播放的 200x~500x，几秒钟即可扫描完长视频。
 */
export async function detectSilence(
  filePath: string,
  opts?: { thresholdDb?: number; minDuration?: number }
): Promise<SilenceDetectResult> {
  const p = await safeProbe(filePath)
  const totalDuration = p?.duration || 0
  if (totalDuration <= 0) {
    throw new Error('无法读取该媒体文件的有效时长')
  }

  const thresholdDb = opts?.thresholdDb ?? -35
  const minDuration = opts?.minDuration ?? 0.5
  const ffmpeg = getFfmpegPath()

  const args = [
    '-i', filePath,
    '-af', `silencedetect=noise=${thresholdDb}dB:d=${minDuration}`,
    '-f', 'null',
    '-'
  ]

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => reject(err))

    child.on('close', (code) => {
      // silencedetect 输出全部在 stderr 中
      const silences: SilenceInterval[] = []
      const lines = stderr.split('\n')
      let currentStart: number | null = null

      for (const line of lines) {
        const startMatch = line.match(/silence_start:\s*([0-9.]+)/)
        if (startMatch) {
          currentStart = parseFloat(startMatch[1])
        }

        const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/)
        if (endMatch) {
          const end = parseFloat(endMatch[1])
          const dur = parseFloat(endMatch[2])
          const start = currentStart !== null ? currentStart : Math.max(0, end - dur)
          silences.push({
            start: Number(start.toFixed(3)),
            end: Number(end.toFixed(3)),
            duration: Number(dur.toFixed(3))
          })
          currentStart = null
        }
      }

      // 如果最后一段静音一直持续到文件末尾（只有 silence_start）
      if (currentStart !== null && currentStart < totalDuration) {
        const dur = totalDuration - currentStart
        if (dur >= minDuration) {
          silences.push({
            start: Number(currentStart.toFixed(3)),
            end: Number(totalDuration.toFixed(3)),
            duration: Number(dur.toFixed(3))
          })
        }
      }

      // 根据静音列表反推有效说话段列表
      const speechSegments: SpeechSegment[] = []
      let lastEnd = 0

      for (const s of silences) {
        if (s.start > lastEnd + 0.05) {
          speechSegments.push({
            start: Number(lastEnd.toFixed(3)),
            end: Number(s.start.toFixed(3)),
            duration: Number((s.start - lastEnd).toFixed(3))
          })
        }
        lastEnd = Math.max(lastEnd, s.end)
      }

      if (lastEnd + 0.05 < totalDuration) {
        speechSegments.push({
          start: Number(lastEnd.toFixed(3)),
          end: Number(totalDuration.toFixed(3)),
          duration: Number((totalDuration - lastEnd).toFixed(3))
        })
      }

      let totalSilenceDuration = 0
      for (const s of silences) totalSilenceDuration += s.duration
      totalSilenceDuration = Number(Math.min(totalDuration, totalSilenceDuration).toFixed(3))

      const estimatedNewDuration = Number(Math.max(0.1, totalDuration - totalSilenceDuration).toFixed(3))
      const savedPercent = Number(((totalSilenceDuration / totalDuration) * 100).toFixed(1))

      resolve({
        totalDuration,
        silenceCount: silences.length,
        totalSilenceDuration,
        estimatedNewDuration,
        savedPercent,
        silences,
        speechSegments
      })
    })
  })
}

export interface JumpCutParams {
  jobId?: string
  input: string
  output?: string
  thresholdDb?: number
  minDuration?: number
  paddingSec?: number // 说话段两端保留的缓冲边际（默认 0.08s 避免吞字）
  onProgress?: ProgressCallback
}

/**
 * 智能跳剪：自动识别无声停顿并消除，将各说话片段无缝拼接合成成片。
 */
export async function jumpCutMedia(o: JumpCutParams): Promise<{ output: string; size: number; cutCount: number; savedSec: number }> {
  const detect = await detectSilence(o.input, { thresholdDb: o.thresholdDb, minDuration: o.minDuration })
  if (detect.silences.length === 0 || detect.speechSegments.length === 0) {
    throw new Error('未检测到符合条件的无声停顿（可能整段均在发声或阈值过低）')
  }

  const padding = o.paddingSec ?? 0.08
  const ext = path.extname(o.input)
  const base = path.basename(o.input, ext)
  const outPath = o.output || path.join(path.dirname(o.input), `${base}_智能跳剪${ext}`)

  // 应用 padding 优化说话段区间，避免断音生硬
  const adjustedSegments: { start: number; end: number }[] = []
  for (let i = 0; i < detect.speechSegments.length; i++) {
    const seg = detect.speechSegments[i]
    const s = Math.max(0, seg.start - padding)
    const e = Math.min(detect.totalDuration, seg.end + padding)
    if (e > s + 0.05) {
      adjustedSegments.push({
        start: Number(s.toFixed(3)),
        end: Number(e.toFixed(3))
      })
    }
  }

  // 构建 filter_complex
  const filterParts: string[] = []
  const concatInputs: string[] = []

  for (let i = 0; i < adjustedSegments.length; i++) {
    const seg = adjustedSegments[i]
    filterParts.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[v${i}]`)
    filterParts.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${i}]`)
    concatInputs.push(`[v${i}][a${i}]`)
  }

  const n = adjustedSegments.length
  filterParts.push(`${concatInputs.join('')}concat=n=${n}:v=1:a=1[outv][outa]`)

  await runFfmpeg({
    jobId: o.jobId || `jumpcut_${Date.now()}`,
    args: [
      '-i', o.input,
      '-filter_complex', filterParts.join(';'),
      '-map', '[outv]',
      '-map', '[outa]',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '20',
      '-c:a', 'aac',
      '-y',
      outPath
    ],
    duration: detect.estimatedNewDuration,
    onProgress: o.onProgress
  })

  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    throw new Error('智能跳剪处理失败，输出文件无效')
  }

  return {
    output: outPath,
    size: fs.statSync(outPath).size,
    cutCount: detect.silences.length,
    savedSec: detect.totalSilenceDuration
  }
}

export interface ReframeParams {
  jobId?: string
  input: string
  output?: string
  width?: number // 默认 1080
  height?: number // 默认 1920
  blurRadius?: number // 高斯模糊半径，默认 25
  onProgress?: ProgressCallback
}

/**
 * 短视频横转竖屏 (16:9 ➔ 9:16) 智能重构：
 * 采用背景原画面自适应缩放 + 动态高斯模糊填底，主体原画居中保持真实纵横比。
 */
export async function reframeToVertical(o: ReframeParams): Promise<{ output: string; size: number }> {
  const targetW = o.width ?? 1080
  const targetH = o.height ?? 1920
  const blur = o.blurRadius ?? 25

  const ext = path.extname(o.input)
  const base = path.basename(o.input, ext)
  const outPath = o.output || path.join(path.dirname(o.input), `${base}_竖屏9比16.mp4`)

  const filter = [
    `[0:v]split=2[orig][bg]`,
    `[bg]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=${blur}:10[blurred]`,
    `[orig]scale=${targetW}:-1:force_original_aspect_ratio=decrease[fg]`,
    `[blurred][fg]overlay=(W-w)/2:(H-h)/2[outv]`
  ].join(';')

  const p = await safeProbe(o.input)
  const duration = p?.duration || 0

  await runFfmpeg({
    jobId: o.jobId || `reframe_${Date.now()}`,
    args: [
      '-i', o.input,
      '-filter_complex', filter,
      '-map', '[outv]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '21',
      '-c:a', 'copy',
      '-y',
      outPath
    ],
    duration,
    onProgress: o.onProgress
  })

  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    throw new Error('竖屏画面重构失败，输出文件无效')
  }

  return {
    output: outPath,
    size: fs.statSync(outPath).size
  }
}
