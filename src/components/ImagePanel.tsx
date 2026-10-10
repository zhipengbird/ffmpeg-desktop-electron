import { useState } from 'react'
import FileDropzone from './FileDropzone'
import BatchQueue from './BatchQueue'
import OutputHint from './OutputHint'
import PresetGroup from './PresetGroup'
import { useQueue } from '../hooks/useQueue'

const PRESETS = [
  { id: 'high', label: '高质量', desc: '质量 90；PNG 无损最大压缩' },
  { id: 'balanced', label: '平衡', desc: '质量 75；PNG 调色板量化' },
  { id: 'small', label: '小体积', desc: '质量 50；PNG 调色板量化' }
] as const

type Fmt = 'keep' | 'jpeg' | 'png' | 'webp'

export default function ImagePanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [preset, setPreset] = useState<'high' | 'balanced' | 'small'>('balanced')
  const [format, setFormat] = useState<Fmt>('keep')
  const [useCustom, setUseCustom] = useState(false)
  const [quality, setQuality] = useState(75)
  const queue = useQueue('image')
  const invalid = useCustom && (!Number.isInteger(quality) || quality < 1 || quality > 100)

  return (
    <>
      <FileDropzone multiple onFiles={queue.add} extensions={['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'avif']}
        hint="支持 JPG / PNG / WebP / GIF / TIFF / AVIF，可多选" compact={queue.snap.items.length > 0} />

      <div className="panel">
        <div className="panel-title">压缩参数</div>
        <div className="form-row">
          <div className="form-group">
            <label>预设</label>
            <PresetGroup options={PRESETS} value={preset} onChange={setPreset} />
          </div>
          <div className="form-group">
            <label>输出格式</label>
            <select value={format} onChange={(e) => setFormat(e.target.value as Fmt)}>
              <option value="keep">保持原格式</option>
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <label className="check-row">
            <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} />
            自定义质量（1–100）
          </label>
          {useCustom && (
            <div className="form-group inline">
              <input type="range" min={1} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
              <input type="number" min={1} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className={invalid ? 'invalid' : ''} style={{ width: 72 }} />
            </div>
          )}
        </div>
        <OutputHint onOpenSettings={onOpenSettings} />
        {!queue.snap.items.length && <div className="empty-tip">添加图片后，在下方任务列表中点击「全部开始」。</div>}
      </div>

      <BatchQueue queue={queue} concurrencyKey="imageConcurrency" startLabel="全部开始"
        startDisabledReason={invalid ? '质量需为 1–100 的整数' : undefined}
        onStartAll={() => queue.start({ preset, format, customQuality: useCustom ? quality : undefined })} />
    </>
  )
}
