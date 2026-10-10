import { STATUS_LABEL, type QueueItem } from '../../shared/types'
import type { QueueApi } from '../hooks/useQueue'
import { basename, formatSize, formatChange } from '../utils/format'
import ProgressBar from './ProgressBar'
import ErrorCard from './ErrorCard'
import { OutputButtons, SizeChange } from './ResultCard'
import { useSettings } from '../hooks/useSettings'

interface Props {
  queue: QueueApi
  onStartAll: () => void
  startLabel: string
  /** 参数不合法等原因禁止开始 */
  startDisabledReason?: string
  concurrencyKey: 'concurrency' | 'imageConcurrency'
}

function ItemRow({ item, queue }: { item: QueueItem; queue: QueueApi }) {
  const canRetry = item.status === 'failed' || item.status === 'cancelled'
  return (
    <li className={`queue-item status-${item.status}`}>
      <div className="qi-head">
        <span className={`status-badge ${item.status}`}>{STATUS_LABEL[item.status]}</span>
        <div className="qi-name" title={item.input}>{basename(item.input)}</div>
        <div className="qi-size">{formatSize(item.inputSize)}</div>
        <div className="qi-actions">
          {canRetry && <button className="icon-btn" title="重试" onClick={() => queue.retry(item.id)}>↻</button>}
          {(item.status === 'pending' || item.status === 'running') && (
            <button className="icon-btn danger" title="取消" onClick={() => queue.cancel(item.id)}>⏹</button>
          )}
          {item.status !== 'running' && (
            <button className="icon-btn" title="移除" onClick={() => queue.remove(item.id)}>✕</button>
          )}
        </div>
      </div>
      {item.status === 'running' && (
        <div className="qi-progress">
          <ProgressBar percent={item.percent} compact />
          <span className="qi-pct">
            {item.percent === null ? (item.timemark ? `已处理 ${item.timemark.replace(/\.\d+$/, '')}` : '处理中…') : `${Math.round(item.percent)}%`}
          </span>
        </div>
      )}
      {item.status === 'done' && item.output && (
        <div className="qi-result">
          <div className="qi-result-text">
            <span
              className="qi-out draggable-file"
              title={`${basename(item.output)}（按住可直接拖拽到桌面或微信）`}
              draggable
              onDragStart={(e) => { e.preventDefault(); window.api.startDrag(item.output!) }}
            >
              {basename(item.output)}
            </span>
            <SizeChange inputSize={item.inputSize} outputSize={item.outputSize ?? 0} />
          </div>
          <OutputButtons output={item.output} small />
        </div>
      )}
      {item.status === 'skipped' && item.output && (
        <div className="qi-result">
          <div className="qi-result-text muted">目标已存在，已跳过：<span className="qi-out">{basename(item.output)}</span></div>
          <OutputButtons output={item.output} small />
        </div>
      )}
      {item.notice && item.status === 'done' && <div className="qi-notice">ℹ {item.notice}</div>}
      {item.status === 'failed' && item.error && <ErrorCard error={item.error} compact />}
    </li>
  )
}

export default function BatchQueue({ queue, onStartAll, startLabel, startDisabledReason, concurrencyKey }: Props) {
  const { snap, summary } = queue
  const { settings, update } = useSettings()
  const finished = summary.done + summary.failed + summary.cancelled + summary.skipped
  const hasPending = summary.pending > 0
  const active = summary.pending + summary.running > 0

  if (!snap.items.length) return null

  return (
    <div className="panel queue-panel">
      <div className="queue-toolbar">
        <div className="panel-title" style={{ marginBottom: 0 }}>任务列表（{summary.total}）</div>
        <div className="queue-conc">
          <label>并发</label>
          <select
            value={settings[concurrencyKey]}
            onChange={(e) => update({ [concurrencyKey]: Number(e.target.value) })}
          >
            {(concurrencyKey === 'imageConcurrency' ? [1, 2, 4, 6, 8] : [1, 2, 3, 4]).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary btn-sm" disabled={!hasPending || snap.running || !!startDisabledReason} title={startDisabledReason} onClick={onStartAll}>
          ▶ {startLabel}
        </button>
        <button className="btn btn-danger btn-sm" disabled={!active} onClick={() => queue.cancelAll()}>全部取消</button>
        <button className="btn btn-ghost btn-sm" disabled={!finished} onClick={() => queue.clearFinished()}>清空已完成</button>
        <button className="btn btn-ghost btn-sm" disabled={snap.running} onClick={() => queue.clearAll()} title="移除所有任务">清空列表</button>
      </div>
      {startDisabledReason && hasPending && <div className="queue-warn">{startDisabledReason}</div>}

      <ul className="queue-list">
        {snap.items.map((it) => <ItemRow key={it.id} item={it} queue={queue} />)}
      </ul>

      <div className="batch-summary">
        <span>共 {summary.total} 项</span>
        {summary.running > 0 && <span className="s-running">处理中 {summary.running}</span>}
        {summary.pending > 0 && <span>等待 {summary.pending}</span>}
        <span className="s-done">完成 {summary.done}</span>
        {summary.failed > 0 && <span className="s-failed">失败 {summary.failed}</span>}
        {summary.cancelled > 0 && <span>已取消 {summary.cancelled}</span>}
        {summary.skipped > 0 && <span>已跳过 {summary.skipped}</span>}
        <div className="spacer" />
        {summary.done > 0 && (
          <span className="s-saved">
            {formatSize(summary.inputBytes)} → {formatSize(summary.outputBytes)}，
            {summary.savedBytes >= 0 ? `共节省 ${formatSize(summary.savedBytes)}` : `共增加 ${formatSize(-summary.savedBytes)}`}
            （{formatChange(summary.inputBytes, summary.outputBytes)}）
          </span>
        )}
      </div>
    </div>
  )
}
