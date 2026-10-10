import { useState } from 'react'
import FileDropzone from './FileDropzone'
import BatchQueue from './BatchQueue'
import OutputHint from './OutputHint'
import PresetGroup from './PresetGroup'
import { useQueue } from '../hooks/useQueue'

const PRESETS = [
  { id: 'high', label: '高质量', desc: 'CRF 18 · medium · 音频 192k' },
  { id: 'balanced', label: '平衡', desc: 'CRF 23 · medium · 音频 128k' },
  { id: 'small', label: '小体积', desc: 'CRF 28 · fast · 音频 96k' }
] as const

const EXTS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'm4v', 'wmv', 'mp3', 'aac', 'wav', 'm4a', 'flac', 'ogg', 'opus']

export default function CompressPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [preset, setPreset] = useState<'high' | 'balanced' | 'small'>('balanced')
  const [useCustom, setUseCustom] = useState(false)
  const [crf, setCrf] = useState(23)
  const [bitrate, setBitrate] = useState('128k')
  const queue = useQueue('compress')
  const crfInvalid = useCustom && (!Number.isInteger(crf) || crf < 0 || crf > 51)

  const startAll = () => {
    queue.start({
      preset,
      customCrf: useCustom ? crf : undefined,
      customAudioBitrate: useCustom ? bitrate : undefined
    })
  }

  return (
    <>
      <FileDropzone multiple onFiles={queue.add} extensions={EXTS} hint="支持视频与音频文件，可多选；音频保持有损格式，WAV/FLAC 等会压缩为 MP3" compact={queue.snap.items.length > 0} />

      <div className="panel">
        <div className="panel-title">压缩参数</div>
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
        <OutputHint video onOpenSettings={onOpenSettings} />
        {!queue.snap.items.length && <div className="empty-tip">添加文件后，在下方任务列表中点击「全部开始」。</div>}
      </div>

      <BatchQueue queue={queue} onStartAll={startAll} startLabel="全部开始" concurrencyKey="concurrency"
        startDisabledReason={crfInvalid ? 'CRF 需为 0–51 的整数' : undefined} />
    </>
  )
}
