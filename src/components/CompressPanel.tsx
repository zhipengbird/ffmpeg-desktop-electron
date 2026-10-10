import { useState } from 'react'
import FileDropzone from './FileDropzone'
import ProgressBar from './ProgressBar'
import ResultBanner from './ResultBanner'
import { useJob } from '../hooks/useJob'
import { isAudio } from '../utils/format'

const PRESETS = [
  { id: 'high', label: '高质量' },
  { id: 'balanced', label: '平衡' },
  { id: 'small', label: '小体积' }
] as const

export default function CompressPanel() {
  const [file, setFile] = useState<string | null>(null)
  const [preset, setPreset] = useState<'high' | 'balanced' | 'small'>('balanced')
  const [useCustom, setUseCustom] = useState(false)
  const [crf, setCrf] = useState(23)
  const [bitrate, setBitrate] = useState('128k')
  const job = useJob()

  const run = async () => {
    if (!file) return
    const jobId = job.start()
    const audioOnly = isAudio(file)
    const res = await window.api.compress({
      jobId,
      input: file,
      preset,
      customCrf: !audioOnly && useCustom ? crf : undefined,
      customBitrate: useCustom ? bitrate : undefined,
      isAudioOnly: audioOnly
    })
    if (res.ok && res.output) {
      job.finish(true, `压缩完成：${res.output}`, res.output)
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
        extensions={['mp4', 'mkv', 'webm', 'avi', 'mov', 'mp3', 'aac', 'wav', 'm4a', 'flac']}
        hint="支持视频与音频文件"
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
        </div>

        <div className="form-row">
          <label className="check-row">
            <input
              type="checkbox"
              checked={useCustom}
              onChange={(e) => setUseCustom(e.target.checked)}
              disabled={job.running}
            />
            自定义参数
          </label>
        </div>

        {useCustom && (
          <div className="form-row">
            {!file || !isAudio(file) ? (
              <div className="form-group">
                <label>CRF（视频质量，越小越好，建议 18–28）</label>
                <input type="number" min={0} max={51} value={crf} onChange={(e) => setCrf(Number(e.target.value))} disabled={job.running} />
              </div>
            ) : null}
            <div className="form-group">
              <label>音频码率</label>
              <select value={bitrate} onChange={(e) => setBitrate(e.target.value)} disabled={job.running}>
                <option value="64k">64 kbps</option>
                <option value="96k">96 kbps</option>
                <option value="128k">128 kbps</option>
                <option value="192k">192 kbps</option>
                <option value="256k">256 kbps</option>
                <option value="320k">320 kbps</option>
              </select>
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

        {job.running && <ProgressBar percent={job.percent} timemark={job.timemark} />}
        {job.result && <ResultBanner ok={job.result.ok} message={job.result.message} output={job.result.output} />}
      </div>
    </>
  )
}
