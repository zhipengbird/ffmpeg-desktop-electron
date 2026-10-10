import { useEffect, useState } from 'react'
import { formatSize } from '../utils/format'

interface Props {
  file: string
  onClose: () => void
}

type GridPreset = '3x3' | '4x4' | '3x4'

export default function ContactSheetModal({ file, onClose }: Props) {
  const [grid, setGrid] = useState<GridPreset>('3x3')
  const [showTimecode, setShowTimecode] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ output: string; size: number; thumbUrl: string } | null>(null)

  const generate = (targetGrid = grid, tc = showTimecode) => {
    setLoading(true)
    setError(null)
    const [colsStr, rowsStr] = targetGrid.split('x')
    const cols = parseInt(colsStr, 10) || 3
    const rows = parseInt(rowsStr, 10) || 3

    window.api.contactSheet({
      input: file,
      cols,
      rows,
      showTimecode: tc
    }).then((res) => {
      setResult(res)
      setLoading(false)
    }).catch((err) => {
      console.error('生成视频剧情概览失败:', err)
      setError('无法为此视频生成剧情分镜长图，请检查视频是否完整或包含有效画面')
      setLoading(false)
    })
  }

  useEffect(() => {
    generate(grid, showTimecode)
  }, [file])

  // Esc 快捷键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleGridChange = (g: GridPreset) => {
    setGrid(g)
    generate(g, showTimecode)
  }

  const handleTcToggle = () => {
    const next = !showTimecode
    setShowTimecode(next)
    generate(grid, next)
  }

  const handleReveal = () => {
    if (result?.output) {
      window.api.showItem(result.output)
    }
  }

  return (
    <div className="compare-modal-backdrop" onClick={onClose}>
      <div className="compare-modal-content contact-sheet-modal" onClick={(e) => e.stopPropagation()}>
        {/* 顶部标题与规格切换 */}
        <div className="compare-modal-header">
          <div className="compare-modal-title">
            <span>📸 视频剧情分镜总览长图 (Video Contact Sheet)</span>
          </div>

          <div className="compare-modal-controls">
            <div className="preset-group">
              <button
                type="button"
                className={`preset-btn ${grid === '3x3' ? 'active' : ''}`}
                onClick={() => handleGridChange('3x3')}
                disabled={loading}
              >
                3x3 (9宫格)
              </button>
              <button
                type="button"
                className={`preset-btn ${grid === '4x4' ? 'active' : ''}`}
                onClick={() => handleGridChange('4x4')}
                disabled={loading}
              >
                4x4 (16宫格)
              </button>
              <button
                type="button"
                className={`preset-btn ${grid === '3x4' ? 'active' : ''}`}
                onClick={() => handleGridChange('3x4')}
                disabled={loading}
              >
                3x4 (12分镜)
              </button>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showTimecode}
                onChange={handleTcToggle}
                disabled={loading}
              />
              <span>烧录时间码</span>
            </label>

            <button className="btn btn-ghost btn-sm" onClick={onClose} title="按 Esc 关闭">
              ✕
            </button>
          </div>
        </div>

        {/* 图像预览主体 */}
        <div className="compare-modal-body contact-sheet-body">
          {loading && (
            <div className="compare-loading-state">
              <div className="spinner" />
              <span>正在均匀抽取关键帧并拼接生成分镜概览大图…</span>
            </div>
          )}

          {error && !loading && (
            <div className="compare-error-state">
              <span className="error-icon">⚠️</span>
              <span>{error}</span>
              <button className="btn btn-primary btn-sm" onClick={() => generate(grid, showTimecode)}>
                重试生成
              </button>
            </div>
          )}

          {!loading && !error && result && (
            <div className="contact-sheet-img-wrapper">
              <img
                src={result.thumbUrl}
                alt="视频剧情分镜总览图"
                className="contact-sheet-img"
              />
            </div>
          )}
        </div>

        {/* 底部信息与保存操作 */}
        <div className="compare-modal-footer">
          <div className="muted" style={{ fontSize: '12px' }}>
            {result ? (
              <span>
                📁 已生成：{result.output.split('/').pop()} ({formatSize(result.size)})
              </span>
            ) : (
              <span>💡 提示：用于审片定位、视频内容大纲归档与素材快速浏览。</span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {result && (
              <button className="btn btn-primary btn-sm" onClick={handleReveal}>
                📂 打开文件所在位置
              </button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={onClose}>
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
