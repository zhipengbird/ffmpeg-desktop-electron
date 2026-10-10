import { useCallback, useState, type DragEvent } from 'react'
import { basename, extname } from '../utils/format'

interface Props {
  /** 单文件模式下当前文件 */
  file?: string | null
  onFiles: (paths: string[]) => void
  onClear?: () => void
  extensions?: string[]
  hint?: string
  multiple?: boolean
  compact?: boolean
  disabled?: boolean
}

export default function FileDropzone({ file, onFiles, onClear, extensions, hint, multiple, compact, disabled }: Props) {
  const [dragover, setDragover] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const accept = useCallback((paths: string[]) => {
    const ok = extensions ? paths.filter((p) => extensions.includes(extname(p).slice(1))) : paths
    const ignored = paths.length - ok.length
    setNote(ignored > 0 ? `已忽略 ${ignored} 个不支持的文件` : null)
    if (ok.length) onFiles(multiple ? ok : [ok[0]])
  }, [extensions, multiple, onFiles])

  const pick = useCallback(async () => {
    if (disabled) return
    const filters = extensions ? [{ name: '支持的文件', extensions }] : undefined
    const paths = await window.api.openFiles(filters, !!multiple)
    if (paths.length) accept(paths)
  }, [extensions, multiple, accept, disabled])

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragover(false)
    if (disabled) return
    const paths = Array.from(e.dataTransfer.files).map((f) => window.api.pathForFile(f)).filter(Boolean)
    if (paths.length) accept(paths)
  }, [accept, disabled])

  if (file && !multiple) {
    return (
      <div className="file-chip">
        <div className="file-icon">📄</div>
        <div className="file-meta">
          <div className="file-name">{basename(file)}</div>
          <div className="file-path">{file}</div>
        </div>
        {onClear && <button className="btn-clear" onClick={onClear} title="清除" disabled={disabled}>✕</button>}
      </div>
    )
  }

  return (
    <div
      className={`dropzone ${dragover ? 'dragover' : ''} ${compact ? 'compact' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={pick}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!disabled) setDragover(true) }}
      onDragLeave={() => setDragover(false)}
      onDrop={onDrop}
      role="button"
      tabIndex={0}
    >
      <div className="dz-icon">📂</div>
      <div className="dz-text">
        <div className="dz-title">{multiple ? '拖放一个或多个文件到此处，或点击选择' : '拖放文件到此处，或点击选择'}</div>
        <div className="dz-hint">{hint || '支持常见音视频与图片格式'}</div>
        {note && <div className="dz-note">{note}</div>}
      </div>
    </div>
  )
}
