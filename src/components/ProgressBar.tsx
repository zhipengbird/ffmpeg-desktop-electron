interface Props {
  percent: number
  timemark?: string
  label?: string
}

export default function ProgressBar({ percent, timemark, label }: Props) {
  return (
    <div className="progress-wrap">
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      <div className="progress-meta">
        <span>{label || '处理中…'}</span>
        <span>{percent}%{timemark ? ` · ${timemark}` : ''}</span>
      </div>
    </div>
  )
}
