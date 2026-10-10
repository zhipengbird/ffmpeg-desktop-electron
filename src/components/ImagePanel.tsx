import { useState } from 'react'
import FileDropzone from './FileDropzone'
import ProgressBar from './ProgressBar'
import ResultBanner from './ResultBanner'
import { useJob } from '../hooks/useJob'

const PRESETS = [
  { id: 'high', label: '高质量' },
  { id: 'balanced', label: '平衡' },
  { id: 'small', label: '小体积' }
] as const

export default function ImagePanel() {
  const [file, setFile] = useState<string | null>(null)
  const [preset, setPreset] = useState<'high' | 'balanced' | 'small'>('balanced')
  const [format, setFormat] = useState<'jpeg' | 'png' | 'webp'>('jpeg')
  const [useCustom, setUseCustom] = useState(false)
  const [quality, setQuality] = useState(75)
  const job = useJob()

  const run = async () => {
    if (!file) return
    const jobId = job.start()
    const res = await window.api.compressImage({
      jobId,
      input: file,
      preset,
      format,
      customQuality: useCustom ? quality : undefined
    })
    if (res.ok && res.output) {
      job.finish(true, `图片压缩完成：${res.output}`, res.output)
    } else {
      job.finish(false, res.error || '压缩失败')
    }
  }

  return (
    <>
      <FileDropzone
        file={file}
        onFile={(p) => { setFile(p); job.reset() }}
        onClear={() => { setFile(null); job.reset() }}
        extensions={['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']}
        hint="支持 JPG / PNG / WebP / GIF / BMP"
      />

      <div className="panel">
        <div className="panel-title">压缩参数</div>
        <div className="form-row">
          <div className="form-group">
            <label>预设</label>
            <div className="preset-group">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`preset-btn ${preset === p.id ? 'active' : ''}`}
                  onClick={() => setPreset(p.id)}
                  disabled={job.running}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>输出格式</label>
            <select value={format} onChange={(e) => setFormat(e.target.value as 'jpeg' | 'png' | 'webp')} disabled={job.running}>
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <label className="check-row">
            <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} disabled={job.running} />
            自定义质量（1–100）
          </label>
        </div>

        {useCustom && (
          <div className="form-row">
            <div className="form-group">
              <label>质量</label>
              <input type="number" min={1} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} disabled={job.running} />
            </div>
          </div>
        )}

        <div className="actions">
          {!job.running ? (
            <button className="btn btn-primary" disabled={!file} onClick={run}>开始压缩</button>
          ) : (
            <button className="btn btn-danger" onClick={job.cancel}>取消</button>
          )}
        </div>

        {job.running && <ProgressBar percent={job.percent} />}
        {job.result && <ResultBanner ok={job.result.ok} message={job.result.message} output={job.result.output} />}
      </div>
    </>
  )
}
