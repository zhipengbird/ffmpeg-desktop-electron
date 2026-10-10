/** HTTP Range 解析（用于 media:// 协议，支持视频拖动进度）。 */

export type RangeResult = { start: number; end: number } | 'unsatisfiable' | null

export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim().split(',')[0].trim())
  if (!m) return null
  const [, a, b] = m
  let start: number
  let end: number
  if (a === '' && b === '') return null
  if (a === '') {
    const suffix = parseInt(b, 10)
    if (suffix === 0) return 'unsatisfiable'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = parseInt(a, 10)
    end = b === '' ? size - 1 : Math.min(parseInt(b, 10), size - 1)
  }
  if (start >= size || start > end) return 'unsatisfiable'
  return { start, end }
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.flv': 'video/x-flv', '.wmv': 'video/x-ms-wmv',
  '.ogv': 'video/ogg', '.ts': 'video/mp2t',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wma': 'audio/x-ms-wma',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif'
}

export function mimeFor(ext: string): string {
  return MIME[ext.toLowerCase()] || 'application/octet-stream'
}

export const PREVIEWABLE_EXTS = Object.keys(MIME)

/** media://local/<encodeURIComponent(path)> → 本地绝对路径 */
export function mediaUrlToPath(url: string): string | null {
  try {
    const u = new URL(url)
    const raw = u.pathname.replace(/^\/+/, '')
    if (!raw) return null
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

export function pathToMediaUrl(p: string): string {
  return `media://local/${encodeURIComponent(p)}`
}
