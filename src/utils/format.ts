export function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

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
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(extname(p))
}

export function isAudio(p: string): boolean {
  return ['.mp3', '.aac', '.wav', '.flac', '.m4a', '.ogg', '.wma'].includes(extname(p))
}

export function isVideo(p: string): boolean {
  return ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv', '.wmv', '.m4v'].includes(extname(p))
}

export function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
