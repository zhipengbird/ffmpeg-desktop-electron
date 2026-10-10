import { spawn } from 'child_process'
import type { EncoderInfo, EncoderTest, QualityPreset } from '../../shared/types'
import { getFfmpegPath } from './binaries'
import { tailLog } from './errors'

export const HW_LABELS: Record<string, string> = {
  h264_videotoolbox: 'Apple VideoToolbox H.264',
  hevc_videotoolbox: 'Apple VideoToolbox HEVC',
  h264_nvenc: 'NVIDIA NVENC H.264',
  hevc_nvenc: 'NVIDIA NVENC HEVC',
  h264_qsv: 'Intel Quick Sync H.264',
  h264_amf: 'AMD AMF H.264',
  h264_vaapi: 'VA-API H.264'
}

export function hwCandidates(platform: string): string[] {
  switch (platform) {
    case 'darwin': return ['h264_videotoolbox', 'hevc_videotoolbox']
    case 'win32': return ['h264_nvenc', 'h264_qsv', 'h264_amf']
    default: return ['h264_nvenc', 'h264_qsv', 'h264_vaapi']
  }
}

/** 解析 `ffmpeg -encoders` 输出，返回编码器名称集合。 */
export function parseEncoderList(text: string): Set<string> {
  const set = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*[VAS][.FSXBD]{5}\s+(\S+)/.exec(line)
    if (m) set.add(m[1])
  }
  return set
}

const VAAPI_DEVICE = '/dev/dri/renderD128'

export interface VideoEncoderSpec {
  name: string
  /** 放在 -i 之前的参数 */
  preInput: string[]
  /** 视频滤镜（-vf） */
  vf?: string
  /** 编码参数（含 -c:v） */
  args: string[]
  hardware: boolean
}

export interface BitrateContext {
  width?: number
  height?: number
  fps?: number
  /** 源视频码率 bps（0 = 未知） */
  srcBitrate?: number
}

const BPP: Record<QualityPreset, number> = { high: 0.08, balanced: 0.05, small: 0.03 }
const SRC_RATIO: Record<QualityPreset, number> = { high: 0.8, balanced: 0.6, small: 0.4 }

/**
 * 硬件编码器不支持 CRF，按分辨率×帧率×bpp 估算目标码率（kbps），
 * 并以源码率的一定比例严格封顶，确保“压缩”绝不会变大。
 */
export function targetBitrateKbps(quality: QualityPreset | { crf: number }, ctx: BitrateContext): number {
  const w = ctx.width && ctx.width > 0 ? ctx.width : 1280
  const h = ctx.height && ctx.height > 0 ? ctx.height : 720
  const fps = Math.min(60, ctx.fps && ctx.fps > 0 ? ctx.fps : 30)
  let bpp: number
  let ratio: number
  if (typeof quality === 'string') {
    bpp = BPP[quality]
    ratio = SRC_RATIO[quality]
  } else {
    const f = Math.pow(2, (23 - quality.crf) / 6)
    bpp = BPP.balanced * f
    ratio = Math.min(0.85, Math.max(0.15, SRC_RATIO.balanced * f))
  }
  let kbps = (w * h * fps * bpp) / 1000
  if (ctx.srcBitrate && ctx.srcBitrate > 0) {
    const srcKbps = ctx.srcBitrate / 1000
    // 无论计算值多大，目标码率不得超过源码率的 ratio 比例；且封顶不超过源码率的 85%
    const capped = Math.min(srcKbps * ratio, srcKbps * 0.85)
    kbps = Math.min(kbps, capped)
  }
  return Math.max(120, Math.round(kbps))
}

export function hwEncoderSpec(name: string, kbps: number): VideoEncoderSpec {
  const rate = ['-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.3)}k`, '-bufsize', `${kbps * 2}k`]
  if (name.endsWith('_videotoolbox')) {
    // VideoToolbox 在部分机型上不支持 DataRateLimits（maxrate），只设平均码率最稳妥；注入 -hwaccel 全链路加速
    return {
      name,
      preInput: ['-hwaccel', 'videotoolbox'],
      hardware: true,
      args: ['-c:v', name, '-b:v', `${kbps}k`, '-pix_fmt', 'yuv420p', ...(name.startsWith('hevc') ? ['-tag:v', 'hvc1'] : [])]
    }
  }
  if (name.endsWith('_nvenc')) {
    return {
      name,
      preInput: ['-hwaccel', 'cuda'],
      hardware: true,
      args: ['-c:v', name, '-preset', 'p5', '-rc', 'vbr', ...rate, '-pix_fmt', 'yuv420p']
    }
  }
  if (name.endsWith('_qsv')) {
    return {
      name,
      preInput: ['-hwaccel', 'qsv'],
      hardware: true,
      args: ['-c:v', name, '-preset', 'medium', ...rate, '-pix_fmt', 'nv12']
    }
  }
  if (name.endsWith('_amf')) {
    return {
      name,
      preInput: ['-hwaccel', 'd3d11va'],
      hardware: true,
      args: ['-c:v', name, '-quality', 'balanced', '-rc', 'vbr_peak', ...rate, '-pix_fmt', 'yuv420p']
    }
  }
  if (name.endsWith('_vaapi')) {
    return {
      name,
      preInput: ['-vaapi_device', VAAPI_DEVICE, '-hwaccel', 'vaapi', '-hwaccel_output_format', 'vaapi'],
      vf: 'format=nv12,hwupload',
      hardware: true,
      args: ['-c:v', name, ...rate]
    }
  }
  return { name, preInput: [], hardware: true, args: ['-c:v', name, ...rate] }
}

/** 软件编码 libx264（CRF）。 */
export function softwareSpec(crf: number, preset: string): VideoEncoderSpec {
  return {
    name: 'libx264', preInput: [], hardware: false,
    vf: "scale='trunc(iw/2)*2':'trunc(ih/2)*2',format=yuv420p",
    args: ['-c:v', 'libx264', '-crf', String(crf), '-preset', preset]
  }
}

function runCapture(bin: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let done = false
    let proc: ReturnType<typeof spawn>
    try {
      proc = spawn(bin, args, { windowsHide: true })
    } catch (e) {
      resolve({ code: -1, stdout, stderr: String(e) })
      return
    }
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL') } catch { /* ignore */ }
      if (!done) { done = true; resolve({ code: -1, stdout, stderr: stderr + '\n检测超时' }) }
    }, timeoutMs)
    proc.stdout?.on('data', (d) => { stdout += d })
    proc.stderr?.on('data', (d) => { stderr += d })
    proc.on('error', (e) => {
      clearTimeout(timer)
      if (!done) { done = true; resolve({ code: -1, stdout, stderr: stderr + String(e) }) }
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (!done) { done = true; resolve({ code, stdout, stderr }) }
    })
  })
}

/** 用 lavfi 生成极短片段试编码，确认编码器真实可用。 */
export async function testEncoder(name: string, ffmpeg = getFfmpegPath(), timeoutMs = 15000): Promise<EncoderTest> {
  const spec = hwEncoderSpec(name, 1000)
  const args = [
    '-hide_banner', '-v', 'error',
    ...spec.preInput,
    '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=25:d=0.5',
    '-frames:v', '10',
    ...(spec.vf ? ['-vf', spec.vf] : []),
    ...spec.args,
    '-f', 'null', '-'
  ]
  const r = await runCapture(ffmpeg, args, timeoutMs)
  return r.code === 0
    ? { name, label: HW_LABELS[name] || name, ok: true }
    : { name, label: HW_LABELS[name] || name, ok: false, error: tailLog(r.stderr, 4) || `退出码 ${r.code}` }
}

/** 检测可用硬件编码器；任何异常都会被吞掉并返回空结果（无 GPU 的机器也能正常运行）。 */
export async function detectHwEncoders(opts: { ffmpeg?: string; platform?: string; timeoutMs?: number } = {}): Promise<EncoderInfo> {
  const ffmpeg = opts.ffmpeg || getFfmpegPath()
  const platform = opts.platform || process.platform
  const info: EncoderInfo = { ready: true, platform, listed: [], tested: [], preferred: null }
  try {
    const r = await runCapture(ffmpeg, ['-hide_banner', '-encoders'], opts.timeoutMs ?? 15000)
    if (r.code !== 0) {
      info.error = tailLog(r.stderr, 4) || '无法列出编码器'
      return info
    }
    const all = parseEncoderList(r.stdout)
    info.listed = hwCandidates(platform).filter((n) => all.has(n))
    for (const name of info.listed) {
      info.tested.push(await testEncoder(name, ffmpeg, opts.timeoutMs ?? 15000))
    }
    info.preferred = info.tested.find((t) => t.ok && t.name.startsWith('h264'))?.name
      ?? info.tested.find((t) => t.ok)?.name ?? null
  } catch (e) {
    info.error = String(e)
  }
  return info
}

/** 根据设置挑选要使用的硬件编码器；不可用时返回 null（走软件编码）。 */
export function chooseHwEncoder(info: EncoderInfo | null, enabled: boolean, wanted: string): string | null {
  if (!enabled || !info) return null
  const ok = info.tested.filter((t) => t.ok).map((t) => t.name)
  if (wanted && wanted !== 'auto' && ok.includes(wanted)) return wanted
  return info.preferred && ok.includes(info.preferred) ? info.preferred : null
}
