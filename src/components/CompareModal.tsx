import { useEffect, useRef, useState } from 'react'

interface Props {
  original: string
  processed: string
  onClose: () => void
}

type ViewMode = 'split' | 'original' | 'processed'

export default function CompareModal({ original, processed, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [origThumb, setOrigThumb] = useState<string | null>(null)
  const [procThumb, setProcThumb] = useState<string | null>(null)
  const [sliderPos, setSliderPos] = useState(50) // 0 to 100
  const [isDragging, setIsDragging] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('split')

  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)

    window.api.compareFrames({ original, processed, timestamp: 1 })
      .then((res) => {
        if (!alive) return
        setOrigThumb(res.originalThumb)
        setProcThumb(res.processedThumb)
        setLoading(false)
      })
      .catch((err) => {
        if (!alive) return
        console.error('加载对比帧失败:', err)
        setError('无法抽取该文件的画质对比画面')
        setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [original, processed])

  // 支持键盘 Esc 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

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

  return (
    <div className="compare-modal-backdrop" onClick={onClose}>
      <div className="compare-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="compare-modal-header">
          <div className="compare-modal-title">
            <span>画质前后像素级对比 (Split Comparison)</span>
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

        <div className="compare-modal-body">
          {loading && (
            <div className="compare-loading-state">
              <div className="spinner" />
              <span>正在抽取并渲染关键帧对比图像…</span>
            </div>
          )}

          {error && (
            <div className="compare-error-state">
              <span className="error-icon">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && origThumb && procThumb && (
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
                  <img src={procThumb} alt="处理后" draggable={false} />
                  <div className="compare-badge compare-badge-right">处理后 / 压缩后</div>
                </div>
              )}

              {/* 顶层：原画图像（根据滑块百分比使用 clip-path 切割） */}
              {(viewMode === 'split' || viewMode === 'original') && (
                <div
                  className="compare-layer compare-layer-original"
                  style={{
                    clipPath: viewMode === 'split' ? `inset(0 ${100 - sliderPos}% 0 0)` : 'none'
                  }}
                >
                  <img src={origThumb} alt="原画" draggable={false} />
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
        </div>

        <div className="compare-modal-footer">
          <div className="muted compare-tip">
            💡 提示：按住鼠标在画面左右拖拽可移动分水岭，对比文字边缘与暗部噪点变化。
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            关闭对比
          </button>
        </div>
      </div>
    </div>
  )
}
