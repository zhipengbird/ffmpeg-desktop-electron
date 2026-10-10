import { useEffect, useState } from 'react'
import FileDropzone from './FileDropzone'
import ProgressBar from './ProgressBar'
import ResultBanner from './ResultBanner'
import { useJob } from '../hooks/useJob'
import { formatDuration } from '../utils/format'

function parseTime(v: string): number {
  const parts = v.trim().split(':').map(Number)
  if (parts.some((n) => Number.isNaN(n))) return NaN
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return NaN
}

function toTimeInput(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function TrimPanel() {
  const [file, setFile] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [startStr, setStartStr] = useState('00:00')
  const [endStr, setEndStr] = useState('00:00')
  const job = useJob()

  useEffect(() => {
    if (!file) {
      setDuration(0)
      return
    }
    window.api.probe(file).then((info) => {
      if ('error' in info) return
      const d = (info.duration as number) || 0
      setDuration(d)
      setStartStr('00:00')
      setEndStr(toTimeInput(d))
    })
  }, [file])

  const run = async () => {
    if (!file) return
    const start = parseTime(startStr)
    const end = parseTime(endStr)
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
      job.finish(false, '请输入有效的起止时间（结束须大于开始）')
      return
    }
    const jobId = job.start()
    const res = await window.api.trim({ jobId, input: file, start, end })
    if (res.ok && res.output) {
      job.finish(true, `截取完成：${res.output}`, res.output)
    } else {
      job.finish(false, res.error || '截取失败')
    }
  }

  return (
    <>
      <FileDropzone
        file={file}
        onFile={(p) => { setFile(p); job.reset() }}
        onClear={() => { setFile(null); job.reset() }}
        extensions={['mp4', 'mkv', 'webm', 'avi', 'mov', 'mp3', 'aac', 'wav', 'm4a']}
        hint="选择要裁剪时长的音视频文件"
      />

      <div className="panel">
        <div className="panel-title">时间范围</div>
        {duration > 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
            媒体总时长：{formatDuration(duration)}
          </p>
        )}
        <div className="form-row">
          <div className="form-group">
            <label>开始时间（分:秒 或 时:分:秒）</label>
            <input type="text" value={startStr} onChange={(e) => setStartStr(e.target.value)} disabled={job.running} placeholder="00:00" />
          </div>
          <div className="form-group">
            <label>结束时间</label>
            <input type="text" value={endStr} onChange={(e) => setEndStr(e.target.value)} disabled={job.running} placeholder="00:10" />
          </div>
        </div>

        <div className="actions">
          {!job.running ? (
            <button className="btn btn-primary" disabled={!file} onClick={run}>开始截取</button>
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
