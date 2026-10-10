import { useCallback, useState, DragEvent } from 'react'
import { basename } from '../utils/format'

interface Props {
  file: string | null
  onFile: (path: string) => void
  onClear: () => void
  accept?: string
  extensions?: string[]
  hint?: string
}

export default function FileDropzone({ file, onFile, onClear, extensions, hint }: Props) {
  const [dragover, setDragover] = useState(false)

  const pick = useCallback(async () => {
    const filters = extensions
      ? [{ name: '支持的文件', extensions }]
      : undefined
    const paths = await window.api.openFiles(filters)
    if (paths.length > 0) onFile(paths[0])
  }, [extensions, onFile])

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    setDragover(false)
    const f = e.dataTransfer.files[0]
    if (!f) return
    // Electron File has path
    const p = (f as File & { path?: string }).path
    if (p) onFile(p)
  }, [onFile])

  if (file) {
    return (
      <div className="file-chip">
        <div className="file-icon">📄</div>
        <div className="file-meta">
          <div className="file-name">{basename(file)}</div>
          <div className="file-path">{file}</div>
        </div>
        <button className="btn-clear" onClick={onClear} title="清除">✕</button>
      </div>
    )
  }

  return (
    <div
      className={`dropzone ${dragover ? 'dragover' : ''}`}
      onClick={pick}
      onDragOver={(e) => { e.preventDefault(); setDragover(true) }}
      onDragLeave={() => setDragover(false)}
      onDrop={onDrop}
    >
      <div className="dz-icon">📂</div>
      <div className="dz-title">拖放文件到此处，或点击选择</div>
      <div className="dz-hint">{hint || '支持常见音视频与图片格式'}</div>
    </div>
  )
}
