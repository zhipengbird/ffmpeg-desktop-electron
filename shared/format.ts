/** 主进程与渲染进程共用的格式化函数（纯函数）。 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** “减少 73.4%” / “增加 5.0%” / “大小不变” */
export function formatChange(before: number, after: number): string {
  if (!before) return ''
  const pct = ((after - before) / before) * 100
  if (Math.abs(pct) < 0.05) return '大小不变'
  return pct < 0 ? `减少 ${Math.abs(pct).toFixed(1)}%` : `增加 ${pct.toFixed(1)}%`
}

export function showInFolderLabel(platform: string): string {
  return platform === 'darwin' ? '在访达中显示' : platform === 'win32' ? '在资源管理器中显示' : '在文件夹中显示'
}
