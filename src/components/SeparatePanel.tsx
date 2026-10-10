import { useState } from 'react'
import FileDropzone from './FileDropzone'
import ProgressBar from './ProgressBar'
import ResultBanner from './ResultBanner'
import { useJob } from '../hooks/useJob'

export default function SeparatePanel() {
  const [file, setFile] = useState<string | null>(null)
  const [mode, setMode] = useState<'audio' | 'video'>('audio')
  const job = useJob()

  const run = async () => {
    if (!file) return
    const jobId = job.start()
    const res = await window.api.separate({ jobId, input: file, mode })
    if (res.ok && res.output) {
      const label = mode === 'audio' ? '音频提取完成' : '无声视频提取完成'
      job.finish(true, `${label}：${res.output}`, res.output)
    } else {
      job.finish(false, res.error || '分离失败')
    }
  }

  return (
    <>
      <FileDropzone
        file={file}
        onFile={(p) => { setFile(p); job.reset() }}
        onClear={() => { setFile(null); job.reset() }}
        extensions={['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'm4v']}
        hint="选择含音视频轨道的视频文件"
      />

      <div className="panel">
        <div className="panel-title">分离模式</div>
        <div className="form-row">
          <div className="preset-group">
            <button className={`preset-btn ${mode === 'audio' ? 'active' : ''}`} onClick={() => setMode('audio')} disabled={job.running}>
              提取音频（MP3）
            </button>
            <button className={`preset-btn ${mode === 'video' ? 'active' : ''}`} onClick={() => setMode('video')} disabled={job.running}>
              提取无声视频
            </button>
          </div>
        </div>

        <div className="actions">
          {!job.running ? (
            <button className="btn btn-primary" disabled={!file} onClick={run}>开始分离</button>
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
