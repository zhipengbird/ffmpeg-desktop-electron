interface Props {
  /** null = 时长未知，显示不确定进度 */
  percent: number | null
  timemark?: string
  label?: string
  compact?: boolean
}

export default function ProgressBar({ percent, timemark, label, compact }: Props) {
  const indeterminate = percent === null || !Number.isFinite(percent)
  const p = indeterminate ? 0 : Math.min(100, Math.max(0, percent as number))
  const time = timemark ? timemark.replace(/\.\d+$/, '') : ''
  return (
    <div className={`progress-wrap ${compact ? 'compact' : ''}`}>
      <div className={`progress-bar ${indeterminate ? 'indeterminate' : ''}`}>
        <div className="progress-fill" style={indeterminate ? undefined : { width: `${p}%` }} />
      </div>
      {!compact && (
        <div className="progress-meta">
          <span>{label || (indeterminate ? '处理中…（无法获取总时长）' : '处理中…')}</span>
          <span>{indeterminate ? (time ? `已处理 ${time}` : '') : `${p.toFixed(p < 100 ? 0 : 0)}%${time ? ` · ${time}` : ''}`}</span>
        </div>
      )}
    </div>
  )
}
