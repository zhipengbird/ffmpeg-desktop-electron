import { basename, formatSize, formatChange, showInFolderLabel } from '../utils/format'
import { sizeChangePercent } from '../../shared/types'

interface Props {
  output: string
  inputSize: number
  outputSize: number
  notice?: string
  skipped?: boolean
  compact?: boolean
}

export function SizeChange({ inputSize, outputSize }: { inputSize: number; outputSize: number }) {
  const pct = sizeChangePercent(inputSize, outputSize)
  const cls = Math.abs(pct) < 0.05 ? 'same' : pct < 0 ? 'down' : 'up'
  return (
    <span className="size-change">
      <span className="size-from">{formatSize(inputSize)}</span>
      <span className="size-arrow">→</span>
      <span className="size-to">{formatSize(outputSize)}</span>
      {inputSize > 0 && <span className={`size-pct ${cls}`}>，{formatChange(inputSize, outputSize)}</span>}
    </span>
  )
}

export function OutputButtons({ output, small }: { output: string; small?: boolean }) {
  const cls = small ? 'btn btn-ghost btn-xs' : 'btn btn-ghost btn-sm'
  return (
    <div className="output-buttons">
      <button className={cls} onClick={() => window.api.openFile(output)} title="用系统默认程序打开">打开文件</button>
      <button className={cls} onClick={() => window.api.showItem(output)}>{showInFolderLabel(window.api.platform)}</button>
    </div>
  )
}

export default function ResultCard({ output, inputSize, outputSize, notice, skipped, compact }: Props) {
  return (
    <div className={`result-card ${skipped ? 'skipped' : ''} ${compact ? 'compact' : ''}`}>
      <div className="result-main">
        <span className="result-icon">{skipped ? '↷' : '✓'}</span>
        <div className="result-info">
          <div className="result-title">{skipped ? '已跳过（目标文件已存在）' : '处理完成'}</div>
          <div className="result-file" title={output}>{basename(output)}</div>
          {!skipped && <div className="result-sizes"><SizeChange inputSize={inputSize} outputSize={outputSize} /></div>}
        </div>
        <OutputButtons output={output} />
      </div>
      {notice && <div className="result-notice">ℹ {notice}</div>}
    </div>
  )
}
