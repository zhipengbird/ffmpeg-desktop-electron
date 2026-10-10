import { useCallback, useEffect, useRef, useState } from 'react'
import FileDropzone from './FileDropzone'
import ProgressBar from './ProgressBar'
import ResultCard from './ResultCard'
import ErrorCard from './ErrorCard'
import RangeSlider from './RangeSlider'
import TimeInput from './TimeInput'
import OutputHint from './OutputHint'
import { useJob } from '../hooks/useJob'
import { formatPreciseTime, isAudio } from '../utils/format'

type PreviewState = 'idle' | 'loading' | 'ok' | 'unsupported'
type Mode = 'fast' | 'precise'

const EXTS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'm4v', 'wmv', 'mp3', 'aac', 'wav', 'm4a', 'flac', 'ogg', 'opus']

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export default function TrimPanel({ onOpenSettings, active }: { onOpenSettings: () => void; active: boolean }) {
  const [file, setFile] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [hasVideo, setHasVideo] = useState(true)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewState>('idle')
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [looping, setLooping] = useState(false)
  const [mode, setMode] = useState<Mode>('fast')
  const job = useJob()
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const rafRef = useRef<number>(0)
  const loopRef = useRef({ looping, start, end })
  loopRef.current = { looping, start, end }

  // 载入文件：探测时长 + 申请预览 URL
  useEffect(() => {
    setUrl(null)
    setPreview('idle')
    setPlaying(false)
    setLooping(false)
    setCurrent(0)
    setProbeError(null)
    setHasVideo(file ? !isAudio(file) : true)
    if (!file) { setDuration(0); return }
    let alive = true
    setPreview('loading')
    window.api.probe(file).then((info) => {
      if (!alive) return
      if ('error' in info) {
        setProbeError(String(info.error))
        setDuration(0)
        return
      }
      const d = Number(info.duration) || 0
      setDuration(d)
      setHasVideo(!!info.video)
      setStart(0)
      setEnd(d)
    })
    window.api.allowMedia(file).then((u) => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [file])

  // 预览超时：长时间无法读取元数据视为不支持
  useEffect(() => {
    if (preview !== 'loading' || !url) return
    const t = setTimeout(() => setPreview((p) => (p === 'loading' ? 'unsupported' : p)), 10000)
    return () => clearTimeout(t)
  }, [preview, url])

  const media = () => (preview === 'ok' ? mediaRef.current : null)

  // 播放中用 rAF 刷新播放头并实现精确循环
  const tick = useCallback(() => {
    const m = mediaRef.current
    if (m) {
      const { looping: lp, start: s, end: e } = loopRef.current
      if (lp && (m.currentTime >= e || m.currentTime < s - 0.3)) m.currentTime = s
      setCurrent(m.currentTime)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    if (playing) rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, tick])

  const seek = useCallback((t: number) => {
    const v = Math.min(Math.max(0, t), duration || t)
    setCurrent(v)
    const m = media()
    if (m) m.currentTime = v
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, preview])

  const togglePlay = useCallback(() => {
    const m = media()
    if (!m) return
    if (m.paused) {
      if (loopRef.current.looping && (m.currentTime < loopRef.current.start || m.currentTime >= loopRef.current.end)) m.currentTime = loopRef.current.start
      void m.play()
    } else m.pause()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview])

  const playSelection = () => {
    const m = media()
    if (!m) return
    if (looping) { setLooping(false); m.pause(); return }
    setLooping(true)
    m.currentTime = start
    void m.play()
  }

  const setRange = useCallback((s: number, e: number) => {
    setStart(Math.max(0, s))
    setEnd(Math.max(s + 0.05, e))
  }, [])

  const [feedback, setFeedback] = useState<string | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showFeedback = useCallback((msg: string) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    setFeedback(msg)
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1600)
  }, [])

  const markIn = useCallback(() => {
    const val = Math.min(current, Math.max(0, end - 0.05))
    setStart(val)
    showFeedback(`📍 起点已设为 ${formatPreciseTime(val)}`)
  }, [current, end, showFeedback])

  const markOut = useCallback(() => {
    const val = Math.max(current, start + 0.05)
    setEnd(val)
    showFeedback(`🏁 终点已设为 ${formatPreciseTime(val)}`)
  }, [current, start, showFeedback])

  const clear = useCallback(() => {
    mediaRef.current?.pause()
    setLooping(false)
    setPlaying(false)
    setFile(null)
    setUrl(null)
    setPreview('idle')
    setCurrent(0)
    setStart(0)
    setEnd(0)
    setDuration(0)
    setProbeError(null)
    job.reset()
  }, [job])

  // 键盘快捷键：I/[ 起点 / O/] 终点 / 空格 播放暂停 / ←→ 微调 / Esc 分层取消
  // 采用 e.code (物理键码) + e.key 兜底，完美兼容中文输入法环境（如输入法打出【】）
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const isEsc = e.key === 'Escape' || e.code === 'Escape'
      if (isEsc) {
        e.preventDefault()
        // 1. 如果正在文本输入框内，按 Esc 优先失焦退出编辑
        if (isTypingTarget(e.target)) {
          ;(e.target as HTMLElement).blur()
          return
        }
        // 2. 如果任务正在运行，取消任务
        if (job.running) {
          void job.cancel()
          showFeedback('⏹ 正在取消任务…')
          return
        }
        // 3. 如果正在循环选区或播放，暂停并退出预览
        if (looping || playing) {
          mediaRef.current?.pause()
          setLooping(false)
          setPlaying(false)
          showFeedback('⏸ 已暂停预览')
          return
        }
        // 4. 如果已有结果或错误卡片，按 Esc 清除结果提示
        if (job.result) {
          job.reset()
          return
        }
        // 5. 如果已加载文件，按 Esc 清空退出当前文件返回选择页
        if (file) {
          clear()
          showFeedback('✕ 已清空当前文件')
        }
        return
      }

      if (!file || duration <= 0) return
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return

      const k = e.key.toLowerCase()
      const isMarkIn = e.code === 'BracketLeft' || e.code === 'KeyI' || e.key === '[' || e.key === '【' || k === 'i'
      const isMarkOut = e.code === 'BracketRight' || e.code === 'KeyO' || e.key === ']' || e.key === '】' || k === 'o'

      if (isMarkIn) {
        e.preventDefault()
        markIn()
      } else if (isMarkOut) {
        e.preventDefault()
        markOut()
      } else if (e.code === 'Space') {
        e.preventDefault()
        // 避免焦点按钮在 keyup 时再次被“点击”
        if ((document.activeElement as HTMLElement | null)?.tagName === 'BUTTON') (document.activeElement as HTMLElement).blur()
        togglePlay()
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') && !(e.target as HTMLElement)?.getAttribute?.('role')) {
        e.preventDefault()
        const step = e.shiftKey ? 1 : 0.1
        const isLeft = e.key === 'ArrowLeft' || e.code === 'ArrowLeft'
        seek(current + (isLeft ? -step : step))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    }
  }, [file, duration, markIn, markOut, togglePlay, seek, current, active, job, looping, playing, clear, showFeedback])

  // 切换到其他标签时暂停预览
  useEffect(() => {
    if (!active) { mediaRef.current?.pause(); setLooping(false) }
  }, [active])

  const run = async () => {
    if (!file) return
    if (!(end > start)) return
    media()?.pause()
    setLooping(false)
    const jobId = job.start()
    const res = await window.api.trim({ jobId, input: file, start, end, mode })
    job.finish(res)
  }
  const segLen = Math.max(0, end - start)
  const audioOnly = file ? (!hasVideo || isAudio(file)) : false
  const rangeInvalid = !(end > start) || (duration > 0 && end > duration + 0.001)

  return (
    <>
      <FileDropzone file={file} onFiles={(ps) => { setFile(ps[0]); job.reset() }} onClear={clear} extensions={EXTS}
        hint="选择要裁剪的音视频文件" disabled={job.running} />

      {file && (
        <div className="panel trim-panel">
          <div className="player">
            {url && preview !== 'unsupported' && (
              audioOnly ? (
                <audio
                  ref={mediaRef} src={url} preload="auto"
                  onLoadedMetadata={() => setPreview('ok')}
                  onError={() => setPreview('unsupported')}
                  onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
                  onSeeked={(e) => setCurrent(e.currentTarget.currentTime)}
                />
              ) : (
                <video
                  ref={mediaRef} src={url} preload="auto" className={preview === 'ok' ? '' : 'hidden'}
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget
                    setPreview(v.videoWidth > 0 ? 'ok' : 'unsupported')
                    if (!duration && Number.isFinite(v.duration)) { setDuration(v.duration); setEnd(v.duration) }
                  }}
                  onError={() => setPreview('unsupported')}
                  onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
                  onSeeked={(e) => setCurrent(e.currentTarget.currentTime)}
                  onClick={togglePlay}
                />
              )
            )}
            {audioOnly && preview === 'ok' && <div className="audio-visual">🎵<span>音频预览</span></div>}
            {preview === 'loading' && <div className="player-placeholder">正在加载预览…</div>}
            {preview === 'unsupported' && (
              <div className="player-placeholder unsupported">
                <div className="ph-icon">🎞</div>
                <div>此格式无法预览，仍可按时间裁剪</div>
                <div className="ph-sub">可拖动下方时间轴或直接输入时间</div>
              </div>
            )}
            {feedback && <div className="trim-toast">{feedback}</div>}
          </div>

          <div className="player-bar">
            <button className="btn btn-ghost btn-sm play-btn" onClick={togglePlay} disabled={preview !== 'ok'} title="播放 / 暂停（空格）">
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="time-display">{formatPreciseTime(current)} / {formatPreciseTime(duration)}</span>
            <div className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={markIn} disabled={duration <= 0} title="快捷键 I">⇤ 设为起点</button>
            <button className="btn btn-ghost btn-sm" onClick={markOut} disabled={duration <= 0} title="快捷键 O">设为终点 ⇥</button>
            <button className={`btn btn-sm ${looping ? 'btn-primary' : 'btn-ghost'}`} onClick={playSelection} disabled={preview !== 'ok'} title="循环播放选中片段">
              {looping ? '■ 停止预览' : '⟲ 预览选区'}
            </button>
          </div>

          {duration > 0 ? (
            <RangeSlider duration={duration} start={start} end={end} current={current} onChange={setRange} onSeek={seek} disabled={job.running} />
          ) : (
            probeError ? <ErrorCard error={{ code: 'FORMAT', message: probeError }} /> : <div className="muted-note">正在读取时长…</div>
          )}

          <div className="form-row time-row">
            <div className="form-group">
              <label>起点</label>
              <TimeInput value={start} max={duration} onCommit={(v) => setRange(Math.min(v, end - 0.05), end)} disabled={job.running} />
            </div>
            <div className="form-group">
              <label>终点</label>
              <TimeInput value={end} max={duration} onCommit={(v) => setRange(start, Math.max(v, start + 0.05))} disabled={job.running} />
            </div>
            <div className="form-group">
              <label>片段时长</label>
              <div className="static-value">{formatPreciseTime(segLen)}</div>
            </div>
          </div>
          <div className="shortcut-tip">快捷键：<kbd>I</kbd> 或 <kbd>[</kbd> 将播放头设为起点 · <kbd>O</kbd> 或 <kbd>]</kbd> 设为终点 · <kbd>空格</kbd> 播放/暂停 · <kbd>←</kbd><kbd>→</kbd> 微调 · <kbd>Esc</kbd> 停止/取消/清空</div>
        </div>
      )}

      {file && (
        <div className="panel">
          <div className="panel-title">裁剪模式</div>
          <div className="mode-cards">
            <button className={`mode-card ${mode === 'fast' ? 'active' : ''}`} onClick={() => setMode('fast')} disabled={job.running}>
              <div className="mc-title">⚡ 极速模式</div>
              <div className="mc-desc">直接复制音视频流，不重新编码，几乎瞬间完成、无画质损失。起点会吸附到最近的关键帧，实际片段可能比设定略早开始。</div>
            </button>
            <button className={`mode-card ${mode === 'precise' ? 'active' : ''}`} onClick={() => setMode('precise')} disabled={job.running}>
              <div className="mc-title">🎯 精准模式</div>
              <div className="mc-desc">重新编码（H.264 / AAC，音频文件按原格式），帧级精确。耗时取决于片段长度{audioOnly ? '' : '，可在设置中开启硬件加速'}。</div>
            </button>
          </div>
          <OutputHint video={mode === 'precise' && !audioOnly} onOpenSettings={onOpenSettings} />
          <div className="actions">
            {!job.running ? (
              <button className="btn btn-primary" disabled={rangeInvalid || duration <= 0} onClick={run}>✂ 开始截取（{formatPreciseTime(segLen)}）</button>
            ) : (
              <button className="btn btn-danger" onClick={job.cancel}>取消</button>
            )}
          </div>
          {job.running && <ProgressBar percent={job.percent} timemark={job.timemark} />}
          {job.result && (job.result.ok
            ? <ResultCard output={job.result.output} inputSize={job.result.inputSize} outputSize={job.result.outputSize} notice={job.result.notice} skipped={job.result.skipped} />
            : <ErrorCard error={job.result.error} title="截取失败" />)}
        </div>
      )}
    </>
  )
}
