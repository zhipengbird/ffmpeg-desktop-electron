/** 进度解析（纯函数）。 */

export function clampPercent(p: number): number {
  if (!Number.isFinite(p)) return 0
  return Math.min(100, Math.max(0, p))
}

/** HH:MM:SS(.ms) → 秒 */
export function parseTimemark(s: string): number | null {
  const m = /^(-)?(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s.trim())
  if (!m) return null
  const v = parseInt(m[2], 10) * 3600 + parseInt(m[3], 10) * 60 + parseFloat(m[4])
  return m[1] ? -v : v
}

export function formatTimemark(sec: number): string {
  const s = Math.max(0, sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s - h * 3600 - m * 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`
}

/** 从 stderr 文本中取最后一个 time=HH:MM:SS.xx（秒）。 */
export function parseStderrTime(text: string): number | null {
  const re = /time=\s*(-?\d+:\d{1,2}:\d{1,2}(?:\.\d+)?)/g
  let last: string | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) last = m[1]
  if (!last) return null
  const v = parseTimemark(last)
  return v === null || v < 0 ? null : v
}

export interface ProgressBlock {
  /** 已处理的输出时间（秒） */
  outTime: number | null
  end: boolean
}

/**
 * 增量解析 `-progress pipe:1` 输出（key=value 行）。
 * 优先使用 out_time_us / out_time_ms（二者在 ffmpeg 中单位都是微秒），再退回 out_time。
 */
export class ProgressParser {
  private buf = ''
  private cur: Record<string, string> = {}

  /** 喂入数据块，返回本次解析出的完整进度块。 */
  push(chunk: string): ProgressBlock[] {
    this.buf += chunk
    const out: ProgressBlock[] = []
    let idx: number
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      const val = line.slice(eq + 1).trim()
      this.cur[key] = val
      if (key === 'progress') {
        out.push({ outTime: ProgressParser.outTimeOf(this.cur), end: val === 'end' })
        this.cur = {}
      }
    }
    return out
  }

  static outTimeOf(kv: Record<string, string>): number | null {
    for (const k of ['out_time_us', 'out_time_ms']) {
      const v = kv[k]
      if (v !== undefined && /^-?\d+$/.test(v)) {
        const n = parseInt(v, 10)
        return n >= 0 ? n / 1_000_000 : null
      }
    }
    if (kv.out_time) {
      const t = parseTimemark(kv.out_time)
      return t !== null && t >= 0 ? t : null
    }
    return null
  }
}

/**
 * 根据当前时间与总时长计算进度。总时长未知（<=0 / NaN）时返回 null（不确定进度）。
 * 运行中最多 99%，完成时由调用方置 100。
 */
export function computePercent(current: number | null, duration: number): number | null {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return null
  if (current === null || !Number.isFinite(current)) return 0
  return Math.min(99, Math.round(clampPercent((current / duration) * 100) * 10) / 10)
}
