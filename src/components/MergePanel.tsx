import { useEffect, useState, useRef } from 'react'
import FileDropzone from './FileDropzone'
import ProgressBar from './ProgressBar'
import ResultCard from './ResultCard'
import ErrorCard from './ErrorCard'
import OutputHint from './OutputHint'
import CompareModal from './CompareModal'
import { useJob } from '../hooks/useJob'
import { formatPreciseTime, formatSize } from '../utils/format'

interface VideoItem {
  id: string
  path: string
  name: string
  size: number
  duration: number
  width: number
  height: number
  vCodec: string
  aCodec: string
}

const VIDEO_EXTS = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'm4v', 'ts']

export default function MergePanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [items, setItems] = useState<VideoItem[]>([])
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'auto' | 'copy' | 'transcode'>('auto')
  const [normalizeAudio, setNormalizeAudio] = useState(false)
  const [compareTarget, setCompareTarget] = useState<{ original: string; processed: string } | null>(null)
  const job = useJob()
  const activeJobIdRef = useRef<string | null>(null)

  // 处理拖入或选择的文件
  const addFiles = async (filePaths: string[]) => {
    const valid = filePaths.filter((p) => {
      const ext = p.split('.').pop()?.toLowerCase() || ''
      return VIDEO_EXTS.includes(ext)
    })
    if (!valid.length) return

    setLoading(true)
    const newItems: VideoItem[] = []
    for (const p of valid) {
      try {
        const [stat, probe] = await Promise.all([
          window.api.stat(p),
          window.api.probe(p)
        ])
        const v = (probe as any)?.video
        const a = (probe as any)?.audio
        newItems.push({
          id: `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          path: p,
          name: p.split(/[\\/]/).pop() || p,
          size: stat?.size || 0,
          duration: (probe as any)?.duration || 0,
          width: v?.width || 0,
          height: v?.height || 0,
          vCodec: v?.codec || 'unknown',
          aCodec: a?.codec || 'none'
        })
      } catch (err) {
        console.error('探测视频失败:', p, err)
      }
    }
    setItems((prev) => [...prev, ...newItems])
    setLoading(false)
  }

  const handlePickFiles = async () => {
    const files = await window.api.openFiles([{ name: '视频文件', extensions: VIDEO_EXTS }], true)
    if (files && files.length) await addFiles(files)
  }

  const moveUp = (index: number) => {
    if (index <= 0) return
    setItems((prev) => {
      const next = [...prev]
      const temp = next[index - 1]
      next[index - 1] = next[index]
      next[index] = temp
      return next
    })
  }

  const moveDown = (index: number) => {
    if (index >= items.length - 1) return
    setItems((prev) => {
      const next = [...prev]
      const temp = next[index + 1]
      next[index + 1] = next[index]
      next[index] = temp
      return next
    })
  }

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  // 分析视频规格是否完全一致
  const first = items[0]
  const isConsistent = items.length >= 2 && items.every((it) =>
    it.width === first.width &&
    it.height === first.height &&
    it.vCodec === first.vCodec &&
    it.aCodec === first.aCodec
  )

  const totalDuration = items.reduce((acc, it) => acc + it.duration, 0)
  const totalInputSize = items.reduce((acc, it) => acc + it.size, 0)

  const handleStartMerge = async () => {
    if (items.length < 2 || job.running) return
    const id = job.start()
    activeJobIdRef.current = id
    try {
      const res = await window.api.merge({
        jobId: id,
        inputs: items.map((it) => it.path),
        mode,
        normalizeAudio
      })
      job.finish(res)
    } catch (e: any) {
      job.finish({ ok: false, error: { code: 'UNKNOWN', message: e?.message || '合并失败' } })
    } finally {
      activeJobIdRef.current = null
    }
  }

  const handleCancel = () => {
    if (activeJobIdRef.current) {
      window.api.cancelJob(activeJobIdRef.current)
    }
    job.cancel()
  }

  return (
    <>
      <div className="panel">
        <div className="panel-title-row">
          <div className="panel-title">视频拼接与多段合并</div>
          {items.length > 0 && (
            <div className="header-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setItems([])} disabled={job.running}>
                清空列表
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handlePickFiles} disabled={job.running}>
                + 继续添加
              </button>
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <FileDropzone
            extensions={VIDEO_EXTS}
            multiple
            onFiles={addFiles}
            hint="支持按顺序拼接多个视频片段，同规格视频支持秒级无损合并"
          />
        ) : (
          <div className="merge-list-container">
            <div className="merge-list-header">
              <span>片段顺序 (共 {items.length} 个视频 · 预计总长 {formatPreciseTime(totalDuration)})</span>
              <span className="muted">源总体积：{formatSize(totalInputSize)}</span>
            </div>

            <div className="merge-items-scroll">
              {items.map((it, idx) => (
                <div key={it.id} className="merge-item-card">
                  <div className="merge-item-index">{idx + 1}</div>
                  <div className="merge-item-info">
                    <div className="merge-item-name" title={it.path}>{it.name}</div>
                    <div className="merge-item-meta muted">
                      {it.width && it.height ? `${it.width}×${it.height}` : '未知分辨率'} · {it.vCodec} · {formatPreciseTime(it.duration)} · {formatSize(it.size)}
                    </div>
                  </div>
                  <div className="merge-item-actions">
                    <button
                      className="btn btn-ghost btn-xs"
                      disabled={idx === 0 || job.running}
                      onClick={() => moveUp(idx)}
                      title="上移"
                    >
                      ▲
                    </button>
                    <button
                      className="btn btn-ghost btn-xs"
                      disabled={idx === items.length - 1 || job.running}
                      onClick={() => moveDown(idx)}
                      title="下移"
                    >
                      ▼
                    </button>
                    <button
                      className="btn btn-ghost btn-xs btn-danger"
                      disabled={job.running}
                      onClick={() => removeItem(idx)}
                      title="删除"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {loading && <div className="muted mt-sm">正在分析视频流规格…</div>}

            {/* 智能规格检测提示 */}
            <div className={`merge-compat-banner ${isConsistent ? 'compat-good' : 'compat-diff'}`}>
              {isConsistent ? (
                <>✨ <strong>所有视频规格一致</strong>：分辨率、编码格式完全吻合，可执行<strong>极速秒级无损合并</strong>（0 损画质）。</>
              ) : (
                <>ℹ️ <strong>视频规格存在差异</strong>：分辨率或编码不一致，将自动以首个视频为基准统一样式、补全音轨并重编码拼接。</>
              )}
            </div>
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="panel">
          <div className="panel-title">合并策略与音频控制</div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-title">拼接模式</div>
              <div className="setting-desc">
                {mode === 'auto' && '智能推荐：规格一致自动极速流复制，不一致自动智能规整合流'}
                {mode === 'copy' && '强制极速流复制：仅拼接流，不重新编码（要求输入格式一致）'}
                {mode === 'transcode' && '强制智能规整：统一缩放至统一分辨率并重编码，兼容性最高'}
              </div>
            </div>
            <div className="setting-control">
              <div className="preset-group">
                <button
                  type="button"
                  className={`preset-btn ${mode === 'auto' ? 'active' : ''}`}
                  onClick={() => setMode('auto')}
                  disabled={job.running}
                >
                  智能推荐
                </button>
                <button
                  type="button"
                  className={`preset-btn ${mode === 'copy' ? 'active' : ''}`}
                  onClick={() => setMode('copy')}
                  disabled={job.running || (!isConsistent && items.length >= 2)}
                  title={!isConsistent ? '各片段规格不同，建议使用智能模式' : ''}
                >
                  极速无损
                </button>
                <button
                  type="button"
                  className={`preset-btn ${mode === 'transcode' ? 'active' : ''}`}
                  onClick={() => setMode('transcode')}
                  disabled={job.running}
                >
                  智能规整
                </button>
              </div>
            </div>
          </div>

          <div className={`feature-toggle-card ${normalizeAudio ? 'active' : ''}`}>
            <div className="feature-info">
              <div className="feature-title">
                <span>🎚️ 广播级音量均衡 (EBU R128)</span>
              </div>
              <div className="feature-desc">自动标准化响度至 -16 LUFS，消除片段间忽大忽小的音量落差</div>
            </div>
            <div className="feature-control">
              <button
                type="button"
                role="switch"
                aria-checked={normalizeAudio}
                className={`toggle ${normalizeAudio ? 'on' : ''}`}
                onClick={() => setNormalizeAudio(!normalizeAudio)}
                disabled={job.running}
                title="开启/关闭广播级音量均衡"
              >
                <span className="knob" />
              </button>
            </div>
          </div>

          <OutputHint
            video
            onOpenSettings={onOpenSettings}
          />

          <div className="panel-actions mt-md">
            {!job.running ? (
              <button
                className="btn btn-primary"
                onClick={handleStartMerge}
                disabled={items.length < 2 || loading}
              >
                开始合并 ({items.length} 个视频)
              </button>
            ) : (
              <button className="btn btn-danger" onClick={handleCancel}>
                取消合并
              </button>
            )}
          </div>

          {job.running && (
            <div className="mt-md">
              <ProgressBar percent={job.percent} timemark={job.timemark} />
            </div>
          )}

          {job.result && !job.result.ok && (
            <div className="mt-md">
              <ErrorCard
                title="合并失败"
                error={job.result.error}
              />
            </div>
          )}

          {job.result && job.result.ok && (
            <div className="mt-md">
              <ResultCard
                output={job.result.output}
                inputSize={job.result.inputSize}
                outputSize={job.result.outputSize}
                notice={job.result.notice}
                encoder={job.result.encoder}
                onDismiss={job.reset}
                onCompare={() => setCompareTarget({ original: items[0].path, processed: (job.result as any).output })}
              />
            </div>
          )}
        </div>
      )}

      {compareTarget && (
        <CompareModal
          original={compareTarget.original}
          processed={compareTarget.processed}
          onClose={() => setCompareTarget(null)}
        />
      )}
    </>
  )
}
