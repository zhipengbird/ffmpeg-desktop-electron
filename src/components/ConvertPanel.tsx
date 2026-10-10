import { useState } from 'react'
import FileDropzone from './FileDropzone'
import ProgressBar from './ProgressBar'
import ResultBanner from './ResultBanner'
import { useJob } from '../hooks/useJob'
import { isAudio, isVideo } from '../utils/format'

const VIDEO_FORMATS = ['mp4', 'mkv', 'webm']
const AUDIO_FORMATS = ['mp3', 'aac', 'wav']

export default function ConvertPanel() {
  const [file, setFile] = useState<string | null>(null)
  const [format, setFormat] = useState('mp4')
  const job = useJob()

  const formats = file && isAudio(file) ? AUDIO_FORMATS : [...VIDEO_FORMATS, ...AUDIO_FORMATS]

  const onFile = (p: string) => {
    setFile(p)
    job.reset()
    if (isAudio(p) && VIDEO_FORMATS.includes(format)) setFormat('mp3')
  }

  const run = async () => {
    if (!file) return
    const jobId = job.start()
    const res = await window.api.convert({ jobId, input: file, format })
    if (res.ok && res.output) {
      job.finish(true, `转换完成：${res.output}`, res.output)
    } else {
      job.finish(false, res.error || '转换失败')
    }
  }

  return (
    <>
      <FileDropzone
        file={file}
        onFile={onFile}
        onClear={() => { setFile(null); job.reset() }}
        extensions={['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'mp3', 'aac', 'wav', 'm4a', 'flac']}
        hint="视频可转为 mp4/mkv/webm 或提取为音频；音频可转为 mp3/aac/wav"
      />

      <div className="panel">
        <div className="panel-title">目标格式</div>
        <div className="form-row">
          <div className="form-group">
            <label>输出格式</label>
            <div className="preset-group">
              {formats.map((f) => (
                <button
                  key={f}
                  className={`preset-btn ${format === f ? 'active' : ''}`}
                  onClick={() => setFormat(f)}
                  disabled={job.running}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {file && isVideo(file) && AUDIO_FORMATS.includes(format) && (
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
            将从视频中提取音频并转换为 {format.toUpperCase()}
          </p>
        )}

        <div className="actions">
          {!job.running ? (
            <button className="btn btn-primary" disabled={!file} onClick={run}>开始转换</button>
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
