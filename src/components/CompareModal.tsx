import { useEffect, useRef, useState } from 'react'

interface Props {
  original: string
  processed: string
  onClose: () => void
}

type ViewMode = 'split' | 'original' | 'processed'
type CompareKind = 'static' | 'video'

function formatSeconds(sec: number): string {
  if (!sec || isNaN(sec) || sec < 0) return '00:00'
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  const remSec = s % 60
  return `${String(m).padStart(2, '0')}:${String(remSec).padStart(2, '0')}`
}

function isImageFile(p: string): boolean {
  const ext = p.slice(p.lastIndexOf('.')).toLowerCase()
  return ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'].includes(ext)
}

export default function CompareModal({ original, processed, onClose }: Props) {
  const isImage = isImageFile(original)

  // 对比大模式：静态单帧精细对比 vs 动态视频同步播放
  const [compareKind, setCompareKind] = useState<CompareKind>('static')
  // 分屏展示模式：分屏滑块 / 仅看原画 / 仅看处理后
  const [viewMode, setViewMode] = useState<ViewMode>('split')

  // 滑块分水岭位置 (0 - 100)
  const [sliderPos, setSliderPos] = useState(50)
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 媒体元数据
  const [duration, setDuration] = useState<number>(0)
  const [origMediaUrl, setOrigMediaUrl] = useState<string | null>(null)
  const [procMediaUrl, setProcMediaUrl] = useState<string | null>(null)

  // 静态抽帧状态
  const [loadingFrame, setLoadingFrame] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [origThumb, setOrigThumb] = useState<string | null>(null)
  const [procThumb, setProcThumb] = useState<string | null>(null)
  const [selectedTimestamp, setSelectedTimestamp] = useState<number>(1)

  // 动态同步播放状态
  const origVideoRef = useRef<HTMLVideoElement>(null)
  const procVideoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isMuted, setIsMuted] = useState(false)

  // 1. 初始化元数据与视频播放地址
  useEffect(() => {
    let alive = true

    if (!isImage) {
      // 视频文件：探测时长与获取流式播放地址
      window.api.probe(original).then((info) => {
        if (!alive) return
        const d = typeof info.duration === 'number' ? info.duration : Number(info.duration) || 0
        setDuration(d)
        // 默认将抽帧时间设定在第 1 秒（若时长小于 1s 则取 0s）
        const initTs = d > 0 && d <= 1 ? 0 : 1
        setSelectedTimestamp(initTs)
      }).catch(() => { /* ignore */ })

      Promise.all([
        window.api.allowMedia(original),
        window.api.allowMedia(processed)
      ]).then(([u1, u2]) => {
        if (!alive) return
        setOrigMediaUrl(u1)
        setProcMediaUrl(u2)
      }).catch((e) => console.warn('获取视频流地址失败:', e))
    }

    return () => {
      alive = false
    }
  }, [original, processed, isImage])

  // 2. 静态抽帧数据加载
  const loadFrameAt = (ts: number) => {
    setLoadingFrame(true)
    setError(null)
    window.api.compareFrames({ original, processed, timestamp: ts })
      .then((res) => {
        setOrigThumb(res.originalThumb)
        setProcThumb(res.processedThumb)
        setLoadingFrame(false)
      })
      .catch((err) => {
        console.error('加载对比帧失败:', err)
        setError('无法抽取该时间点的画质对比画面，请检查文件是否完整')
        setLoadingFrame(false)
      })
  }

  // 首次或目标文件切换时拉取首帧
  useEffect(() => {
    loadFrameAt(selectedTimestamp)
  }, [original, processed])

  // 支持键盘 Esc 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // 分屏滑块拖拽逻辑
  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true)
    updateSliderPos(e.clientX)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging) {
      updateSliderPos(e.clientX)
    }
  }

  const handlePointerUp = () => {
    setIsDragging(false)
  }

  const updateSliderPos = (clientX: number) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const offsetX = clientX - rect.left
    const percent = Math.max(0, Math.min(100, (offsetX / rect.width) * 100))
    setSliderPos(percent)
  }

  // 动态播放控制逻辑
  const togglePlay = () => {
    const v1 = origVideoRef.current
    const v2 = procVideoRef.current
    if (!v1 || !v2) return

    if (isPlaying) {
      v1.pause()
      v2.pause()
      setIsPlaying(false)
    } else {
      // 保持对齐后同时起播
      v2.currentTime = v1.currentTime
      Promise.all([v1.play(), v2.play()]).then(() => {
        setIsPlaying(true)
      }).catch((e) => console.warn('播放失败:', e))
    }
  }

  const handleVideoSeek = (newTime: number) => {
    const v1 = origVideoRef.current
    const v2 = procVideoRef.current
    if (v1) v1.currentTime = newTime
    if (v2) v2.currentTime = newTime
    setCurrentTime(newTime)
  }

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate)
    if (origVideoRef.current) origVideoRef.current.playbackRate = rate
    if (procVideoRef.current) procVideoRef.current.playbackRate = rate
  }

  const handleTimeUpdate = () => {
    const v1 = origVideoRef.current
    const v2 = procVideoRef.current
    if (!v1) return
    setCurrentTime(v1.currentTime)

    // 时钟自动校准：若副视频与主视频时间漂移超过 0.08 秒，强行对其
    if (v2 && Math.abs(v1.currentTime - v2.currentTime) > 0.08) {
      v2.currentTime = v1.currentTime
    }
  }

  // 切换至动态模式时暂停/重置
  const switchMode = (mode: CompareKind) => {
    if (mode === 'static' && isPlaying) {
      origVideoRef.current?.pause()
      procVideoRef.current?.pause()
      setIsPlaying(false)
    }
    setCompareKind(mode)
  }

  return (
    <div className="compare-modal-backdrop" onClick={onClose}>
      <div className="compare-modal-content" onClick={(e) => e.stopPropagation()}>
        {/* 顶部标题与控制栏 */}
        <div className="compare-modal-header">
          <div className="compare-modal-title">
            <span>画质前后像素级对比</span>
            {!isImage && (
              <div className="compare-mode-switch">
                <button
                  type="button"
                  className={`compare-mode-btn ${compareKind === 'static' ? 'active' : ''}`}
                  onClick={() => switchMode('static')}
                >
                  🔬 像素级单帧细节
                </button>
                <button
                  type="button"
                  className={`compare-mode-btn ${compareKind === 'video' ? 'active' : ''}`}
                  onClick={() => switchMode('video')}
                >
                  🎬 动态同步播放
                </button>
              </div>
            )}
          </div>

          <div className="compare-modal-controls">
            <div className="preset-group">
              <button
                type="button"
                className={`preset-btn ${viewMode === 'split' ? 'active' : ''}`}
                onClick={() => setViewMode('split')}
              >
                左右分屏滑块
              </button>
              <button
                type="button"
                className={`preset-btn ${viewMode === 'original' ? 'active' : ''}`}
                onClick={() => setViewMode('original')}
              >
                仅看原画
              </button>
              <button
                type="button"
                className={`preset-btn ${viewMode === 'processed' ? 'active' : ''}`}
                onClick={() => setViewMode('processed')}
              >
                仅看处理后
              </button>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onClose} title="按 Esc 关闭">
              ✕
            </button>
          </div>
        </div>

        {/* 主画布舞台区 */}
        <div className="compare-modal-body">
          {compareKind === 'static' && loadingFrame && (
            <div className="compare-loading-state">
              <div className="spinner" />
              <span>正在抽取并渲染时间点【{formatSeconds(selectedTimestamp)}】关键帧画面…</span>
            </div>
          )}

          {compareKind === 'static' && error && (
            <div className="compare-error-state">
              <span className="error-icon">⚠️</span>
              <span>{error}</span>
              <button className="btn btn-primary btn-sm" onClick={() => loadFrameAt(selectedTimestamp)}>
                重试提取
              </button>
            </div>
          )}

          {/* 模式 A：像素级单帧细节分水岭 */}
          {compareKind === 'static' && !loadingFrame && !error && origThumb && procThumb && (
            <div
              ref={containerRef}
              className={`compare-stage-container ${isDragging ? 'is-dragging' : ''}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            >
              {/* 底层：处理后图像 */}
              {(viewMode === 'split' || viewMode === 'processed') && (
                <div className="compare-layer compare-layer-processed">
                  <img
                    src={procThumb}
                    alt="处理后"
                    draggable={false}
                    onError={() => setError('处理后对比画面渲染失败')}
                  />
                  <div className="compare-badge compare-badge-right">处理后 / 压缩后</div>
                </div>
              )}

              {/* 顶层：源文件原画（根据滑块百分比 clip-path 切割） */}
              {(viewMode === 'split' || viewMode === 'original') && (
                <div
                  className="compare-layer compare-layer-original"
                  style={{
                    clipPath: viewMode === 'split' ? `inset(0 ${100 - sliderPos}% 0 0)` : 'none'
                  }}
                >
                  <img
                    src={origThumb}
                    alt="原画"
                    draggable={false}
                    onError={() => setError('源文件对比画面渲染失败')}
                  />
                  <div className="compare-badge compare-badge-left">源文件原画</div>
                </div>
              )}

              {/* 分割线与拖动手柄 */}
              {viewMode === 'split' && (
                <div
                  className="compare-divider-line"
                  style={{ left: `${sliderPos}%` }}
                >
                  <div className="compare-handle">
                    <span className="handle-arrow">◀</span>
                    <span className="handle-bar" />
                    <span className="handle-arrow">▶</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 模式 B：双视频动态同步播放分水岭 */}
          {compareKind === 'video' && (
            <div
              ref={containerRef}
              className={`compare-stage-container ${isDragging ? 'is-dragging' : ''}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            >
              {/* 底层：处理后视频 */}
              {(viewMode === 'split' || viewMode === 'processed') && procMediaUrl && (
                <div className="compare-layer compare-layer-processed">
                  <video
                    ref={procVideoRef}
                    src={procMediaUrl}
                    muted={true}
                    playsInline
                    loop
                  />
                  <div className="compare-badge compare-badge-right">处理后 (动态)</div>
                </div>
              )}

              {/* 顶层：原画视频 */}
              {(viewMode === 'split' || viewMode === 'original') && origMediaUrl && (
                <div
                  className="compare-layer compare-layer-original"
                  style={{
                    clipPath: viewMode === 'split' ? `inset(0 ${100 - sliderPos}% 0 0)` : 'none'
                  }}
                >
                  <video
                    ref={origVideoRef}
                    src={origMediaUrl}
                    muted={isMuted}
                    playsInline
                    loop
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={() => setIsPlaying(false)}
                  />
                  <div className="compare-badge compare-badge-left">源文件 (动态)</div>
                </div>
              )}

              {/* 分割线与拖动手柄 */}
              {viewMode === 'split' && (
                <div
                  className="compare-divider-line"
                  style={{ left: `${sliderPos}%` }}
                >
                  <div className="compare-handle">
                    <span className="handle-arrow">◀</span>
                    <span className="handle-bar" />
                    <span className="handle-arrow">▶</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部控制栏 */}
        {/* 1. 静态单帧模式：时间轴选点器与快捷跳转 */}
        {compareKind === 'static' && !isImage && duration > 0 && (
          <div className="compare-control-bar">
            <div className="compare-timeline-row">
              <span className="compare-time-display">
                ⏱️ 对比点：{formatSeconds(selectedTimestamp)} / {formatSeconds(duration)}
              </span>
              <input
                type="range"
                className="compare-seek-slider"
                min={0}
                max={Math.max(1, duration)}
                step={0.1}
                value={selectedTimestamp}
                onChange={(e) => setSelectedTimestamp(Number(e.target.value))}
                onMouseUp={() => loadFrameAt(selectedTimestamp)}
                onTouchEnd={() => loadFrameAt(selectedTimestamp)}
              />
              <div className="compare-preset-chips">
                <button
                  type="button"
                  className={`compare-chip-btn ${selectedTimestamp === 0 ? 'active' : ''}`}
                  onClick={() => { setSelectedTimestamp(0); loadFrameAt(0) }}
                >
                  首帧 (0s)
                </button>
                <button
                  type="button"
                  className="compare-chip-btn"
                  onClick={() => {
                    const t = Number((duration * 0.25).toFixed(1))
                    setSelectedTimestamp(t)
                    loadFrameAt(t)
                  }}
                >
                  25%
                </button>
                <button
                  type="button"
                  className="compare-chip-btn"
                  onClick={() => {
                    const t = Number((duration * 0.5).toFixed(1))
                    setSelectedTimestamp(t)
                    loadFrameAt(t)
                  }}
                >
                  50%
                </button>
                <button
                  type="button"
                  className="compare-chip-btn"
                  onClick={() => {
                    const t = Number((duration * 0.75).toFixed(1))
                    setSelectedTimestamp(t)
                    loadFrameAt(t)
                  }}
                >
                  75%
                </button>
                <button
                  type="button"
                  className="compare-chip-btn"
                  onClick={() => {
                    const t = Math.max(0, Number((duration - 0.2).toFixed(1)))
                    setSelectedTimestamp(t)
                    loadFrameAt(t)
                  }}
                >
                  尾帧
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 2. 动态视频模式：双轨同步播放控制器 */}
        {compareKind === 'video' && (
          <div className="compare-control-bar">
            <div className="compare-player-row">
              <div className="compare-player-left">
                <button
                  type="button"
                  className="compare-play-btn"
                  onClick={togglePlay}
                  title={isPlaying ? '暂停' : '播放'}
                >
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <span className="compare-time-display">
                  {formatSeconds(currentTime)} / {formatSeconds(duration)}
                </span>
                <input
                  type="range"
                  className="compare-seek-slider"
                  style={{ width: '380px' }}
                  min={0}
                  max={Math.max(1, duration)}
                  step={0.05}
                  value={currentTime}
                  onChange={(e) => handleVideoSeek(Number(e.target.value))}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setIsMuted(!isMuted)}
                  title={isMuted ? '取消静音' : '原声音频'}
                >
                  {isMuted ? '🔇 静音' : '🔊 原音'}
                </button>
                <select
                  className="compare-speed-select"
                  value={playbackRate}
                  onChange={(e) => handleSpeedChange(Number(e.target.value))}
                  title="播放速率（慢放可精细观察动态噪点）"
                >
                  <option value={0.5}>0.5x 慢放</option>
                  <option value={1.0}>1.0x 原速</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2.0}>2.0x 倍速</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* 页脚提示 */}
        <div className="compare-modal-footer">
          <div className="muted compare-tip">
            {compareKind === 'static'
              ? '💡 提示：按住鼠标在画面左右拖拽可移动分水岭；拖动时间轴可对比不同秒数的关键帧细节。'
              : '💡 提示：双视频同频播放，边播边拖动分水岭滑块，可实时对比运动模糊、动态色块与帧率。'}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            关闭对比
          </button>
        </div>
      </div>
    </div>
  )
}
