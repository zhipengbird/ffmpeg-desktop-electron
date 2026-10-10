export { formatSize, formatChange, showInFolderLabel } from '../../shared/format'

export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatBitrate(bps: number): string {
  if (!bps) return '—'
  if (bps < 1000) return `${bps} bps`
  if (bps < 1000000) return `${Math.round(bps / 1000)} kbps`
  return `${(bps / 1000000).toFixed(2)} Mbps`
}

export function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() || p
}

export function extname(p: string): string {
  const base = basename(p)
  const i = base.lastIndexOf('.')
  return i >= 0 ? base.slice(i).toLowerCase() : ''
}

export function isImage(p: string): boolean {
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif'].includes(extname(p))
}

export function isAudio(p: string): boolean {
  return ['.mp3', '.aac', '.wav', '.flac', '.m4a', '.ogg', '.opus', '.wma'].includes(extname(p))
}

export function isVideo(p: string): boolean {
  return ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv', '.wmv', '.m4v'].includes(extname(p))
}

export function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** 精确时间：HH:MM:SS.mmm（不足 1 小时显示 MM:SS.mmm） */
export function formatPreciseTime(sec: number): string {
  const s = Math.max(0, Number.isFinite(sec) ? sec : 0)
  const totalMs = Math.round(s * 1000)
  const h = Math.floor(totalMs / 3600000)
  const m = Math.floor((totalMs % 3600000) / 60000)
  const ss = Math.floor((totalMs % 60000) / 1000)
  const ms = totalMs % 1000
  const core = `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
  return h > 0 ? `${String(h).padStart(2, '0')}:${core}` : core
}

/** 解析 “时:分:秒.毫秒” / “分:秒” / “秒” → 秒；非法返回 NaN */
export function parseTime(v: string): number {
  const t = v.trim()
  if (!t) return NaN
  const parts = t.split(':')
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p.trim()))) return NaN
  const nums = parts.map((p) => parseFloat(p))
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2]
  if (nums.length === 2) return nums[0] * 60 + nums[1]
  return nums[0]
}
