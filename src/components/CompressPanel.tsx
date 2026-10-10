import { useState } from 'react'
import FileDropzone from './FileDropzone'
import BatchQueue from './BatchQueue'
import OutputHint from './OutputHint'
import PresetGroup from './PresetGroup'
import { useQueue } from '../hooks/useQueue'

type CompressMode = 'preset' | 'target'

const PRESETS = [
  { id: 'high', label: '高质量', desc: 'CRF 18 · medium · 音频 192k' },
  { id: 'balanced', label: '平衡', desc: 'CRF 23 · medium · 音频 128k' },
  { id: 'small', label: '小体积', desc: 'CRF 28 · fast · 音频 96k' }
] as const

const SIZE_PRESETS = [
  { mb: 10, label: '网页 / 钉钉 (10 MB)' },
  { mb: 20, label: '微信 (20 MB)' },
  { mb: 25, label: '邮箱 (25 MB)' },
  { mb: 50, label: '平台 (50 MB)' }
]

const EXTS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'm4v', 'wmv', 'mp3', 'aac', 'wav', 'm4a', 'flac', 'ogg', 'opus']

export default function CompressPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [compressMode, setCompressMode] = useState<CompressMode>('preset')
  const [preset, setPreset] = useState<'high' | 'balanced' | 'small'>('balanced')
  const [targetSize, setTargetSize] = useState<number>(20)
  const [useCustom, setUseCustom] = useState(false)
  const [crf, setCrf] = useState(23)
  const [bitrate, setBitrate] = useState('128k')
  const queue = useQueue('compress')

  const crfInvalid = compressMode === 'preset' && useCustom && (!Number.isInteger(crf) || crf < 0 || crf > 51)
  const targetInvalid = compressMode === 'target' && (!Number.isFinite(targetSize) || targetSize <= 0)

  const startAll = () => {
    if (compressMode === 'target') {
      queue.start({
        preset: 'balanced',
        targetSizeMB: targetSize
      })
      return
    }
    queue.start({
      preset,
      customCrf: useCustom ? crf : undefined,
      customAudioBitrate: useCustom ? bitrate : undefined
    })
  }

  const disabledReason = crfInvalid
    ? 'CRF 需为 0–51 的整数'
    : targetInvalid
      ? '目标文件大小必须大于 0 MB'
      : undefined

  return (
    <>
      <FileDropzone multiple onFiles={queue.add} extensions={EXTS} hint="支持视频与音频文件，可多选；音频保持有损格式，WAV/FLAC 等会压缩为 MP3" compact={queue.snap.items.length > 0} />

      <div className="panel">
        <div className="panel-title">压缩模式</div>
        <div className="mode-cards" style={{ marginBottom: 12 }}>
          <button className={`mode-card ${compressMode === 'preset' ? 'active' : ''}`} onClick={() => setCompressMode('preset')}>
            <div className="mc-title">⚡ 画质预设模式</div>
            <div className="mc-desc">通过 CRF 恒定画质比率压缩，在保持清晰度的同时最大限度削减多余数据。</div>
          </button>
          <button className={`mode-card ${compressMode === 'target' ? 'active' : ''}`} onClick={() => setCompressMode('target')}>
            <div className="mc-title">🎯 锁定目标大小 (微信/邮件/钉钉)</div>
            <div className="mc-desc">指定期望的最大文件大小（如 20 MB），算法根据时长反算码率，确保不超出限制。</div>
          </button>
        </div>

        {compressMode === 'preset' ? (
          <>
            <div className="form-row">
              <div className="form-group">
                <label>预设</label>
                <PresetGroup options={PRESETS} value={preset} onChange={setPreset} />
              </div>
            </div>

            <div className="form-row">
              <label className="check-row">
                <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} />
                自定义参数
              </label>
            </div>

            {useCustom && (
              <div className="form-row">
                <div className="form-group">
                  <label>CRF（视频质量，越小越好，建议 18–28）</label>
                  <input type="number" min={0} max={51} value={crf} onChange={(e) => setCrf(Number(e.target.value))} className={crfInvalid ? 'invalid' : ''} />
                </div>
                <div className="form-group">
                  <label>音频码率</label>
                  <select value={bitrate} onChange={(e) => setBitrate(e.target.value)}>
                    {['64k', '96k', '128k', '192k', '256k', '320k'].map((b) => <option key={b} value={b}>{b.replace('k', ' kbps')}</option>)}
                  </select>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="target-size-section">
            <div className="form-row">
              <div className="form-group">
                <label>常用目标体积预设</label>
                <div className="preset-group">
                  {SIZE_PRESETS.map((p) => (
                    <button
                      key={p.mb}
                      className={`preset-btn ${targetSize === p.mb ? 'active' : ''}`}
                      onClick={() => setTargetSize(p.mb)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="form-row" style={{ marginTop: 8 }}>
              <div className="form-group" style={{ maxWidth: 220 }}>
                <label>目标体积 (MB)</label>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={targetSize || ''}
                  onChange={(e) => setTargetSize(Number(e.target.value))}
                  className={targetInvalid ? 'invalid' : ''}
                  placeholder="例如 20"
                />
              </div>
            </div>
            <p className="muted-note" style={{ marginTop: 6 }}>
              💡 系统已预留 5% 封装余量以防超限。若视频时长较长，建议适当允许画质降档或截取分段。
            </p>
          </div>
        )}

        <OutputHint video onOpenSettings={onOpenSettings} />
        {!queue.snap.items.length && <div className="empty-tip">添加文件后，在下方任务列表中点击「全部开始」。</div>}
      </div>

      <BatchQueue queue={queue} onStartAll={startAll} startLabel="全部开始" concurrencyKey="concurrency"
        startDisabledReason={disabledReason} />
    </>
  )
}
