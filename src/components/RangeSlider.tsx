import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { formatDuration } from '../utils/format'
import WaveformBar from './WaveformBar'

interface Props {
  duration: number
  start: number
  end: number
  current: number
  peaks?: number[]
  onChange: (start: number, end: number) => void
  onSeek: (t: number) => void
  disabled?: boolean
}

const MIN_GAP = 0.05

/** 双滑块时间轴：起点 / 终点手柄 + 播放头，点击轨道可跳转。 */
export default function RangeSlider({ duration, start, end, current, peaks, onChange, onSeek, disabled }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<'start' | 'end' | 'seek' | null>(null)
  const isInvalid = !Number.isFinite(duration) || duration <= 0
  const d = !isInvalid ? duration : 1
  const pct = (t: number) => {
    if (!Number.isFinite(t) || isInvalid) return '0%'
    return `${Math.min(100, Math.max(0, (t / d) * 100))}%`
  }

  const timeAt = useCallback((clientX: number) => {
    const el = trackRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    const x = Math.min(Math.max(0, clientX - r.left), r.width)
    return r.width > 0 ? (x / r.width) * d : 0
  }, [d])

  const apply = useCallback((which: 'start' | 'end' | 'seek', t: number) => {
    if (which === 'start') onChange(Math.min(Math.max(0, t), Math.max(0, end - MIN_GAP)), end)
    else if (which === 'end') onChange(start, Math.max(Math.min(d, t), start + MIN_GAP))
    else onSeek(Math.min(Math.max(0, t), d))
  }, [start, end, d, onChange, onSeek])

  const onDown = (which: 'start' | 'end' | 'seek') => (e: PointerEvent) => {
    if (disabled || duration <= 0) return
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = which
    trackRef.current?.setPointerCapture(e.pointerId)
    apply(which, timeAt(e.clientX))
  }
  const onMove = (e: PointerEvent) => {
    if (!dragRef.current) return
    apply(dragRef.current, timeAt(e.clientX))
  }
  const onUp = (e: PointerEvent) => {
    dragRef.current = null
    try { trackRef.current?.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  const onKey = (which: 'start' | 'end') => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
      const base = which === 'start' ? start : end
      apply(which, base + (e.key === 'ArrowLeft' ? -step : step))
    }
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className={`range-slider ${disabled ? 'disabled' : ''}`}>
      <div
        className="rs-track"
        ref={trackRef}
        onPointerDown={onDown('seek')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {peaks && peaks.length > 0 && (
          <WaveformBar peaks={peaks} duration={duration} start={start} end={end} currentTime={current} />
        )}
        <div className="rs-sel" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />
        <div className="rs-playhead" style={{ left: pct(current) }} />
        <div
          className="rs-handle start" style={{ left: pct(start) }} role="slider" tabIndex={0}
          aria-label="起点" aria-valuemin={0} aria-valuemax={d} aria-valuenow={start}
          onPointerDown={onDown('start')} onKeyDown={onKey('start')} title="拖动设置起点（←/→ 微调，Shift 加速）"
        />
        <div
          className="rs-handle end" style={{ left: pct(end) }} role="slider" tabIndex={0}
          aria-label="终点" aria-valuemin={0} aria-valuemax={d} aria-valuenow={end}
          onPointerDown={onDown('end')} onKeyDown={onKey('end')} title="拖动设置终点（←/→ 微调，Shift 加速）"
        />
      </div>
      <div className="rs-ticks">
        {!isInvalid && ticks.map((t) => <span key={t} style={{ left: `${t * 100}%` }}>{formatDuration(t * duration)}</span>)}
      </div>
    </div>
  )
}
