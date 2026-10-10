import { useState } from 'react'
import type { JobError } from '../../shared/types'

interface Props {
  error: JobError
  title?: string
  compact?: boolean
}

export default function ErrorCard({ error, title, compact }: Props) {
  const [copied, setCopied] = useState(false)
  const cancelled = error.code === 'CANCELLED'
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(error.detail || error.message)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }
  return (
    <div className={`error-card ${cancelled ? 'muted' : ''} ${compact ? 'compact' : ''}`}>
      <div className="error-head">
        <span className="error-icon">{cancelled ? '⏹' : '⚠'}</span>
        <div className="error-msg">
          {title && <strong>{title}：</strong>}
          {error.message}
        </div>
      </div>
      {error.detail && !cancelled && (
        <details className="error-detail">
          <summary>详细日志</summary>
          <pre>{error.detail}</pre>
          <button className="btn btn-ghost btn-xs" onClick={copy}>{copied ? '已复制' : '复制日志'}</button>
        </details>
      )}
    </div>
  )
}
