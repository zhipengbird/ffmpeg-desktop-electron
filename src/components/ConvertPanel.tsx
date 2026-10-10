import { useState } from 'react'
import FileDropzone from './FileDropzone'
import BatchQueue from './BatchQueue'
import OutputHint from './OutputHint'
import { useQueue } from '../hooks/useQueue'
import { isAudio } from '../utils/format'

const VIDEO_FORMATS = ['mp4', 'mkv', 'webm']
const AUDIO_FORMATS = ['mp3', 'aac', 'wav']

export default function ConvertPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [format, setFormat] = useState('mp4')
  const queue = useQueue('convert')
  const pendingInputs = queue.snap.items.filter((i) => i.status === 'pending').map((i) => i.input)
  const hasAudioInput = pendingInputs.some(isAudio)
  const videoTarget = VIDEO_FORMATS.includes(format)
  const reason = hasAudioInput && videoTarget ? '列表中包含纯音频文件，无法转换为视频格式；请选择音频格式或移除这些文件' : undefined

  const onFiles = (paths: string[]) => {
    queue.add(paths)
    if (paths.length && paths.every(isAudio) && videoTarget && !queue.snap.items.length) setFormat('mp3')
  }

  return (
    <>
      <FileDropzone multiple onFiles={onFiles}
        extensions={['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'm4v', 'wmv', 'mp3', 'aac', 'wav', 'm4a', 'flac', 'ogg', 'opus']}
        hint="视频可转为 MP4/MKV/WebM 或提取为音频；音频可转为 MP3/AAC/WAV；可多选" compact={queue.snap.items.length > 0} />

      <div className="panel">
        <div className="panel-title">目标格式</div>
        <div className="form-row">
          <div className="form-group">
            <label>视频</label>
            <div className="preset-group">
              {VIDEO_FORMATS.map((f) => (
                <button key={f} className={`preset-btn ${format === f ? 'active' : ''}`} onClick={() => setFormat(f)}>{f.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>音频</label>
            <div className="preset-group">
              {AUDIO_FORMATS.map((f) => (
                <button key={f} className={`preset-btn ${format === f ? 'active' : ''}`} onClick={() => setFormat(f)}>{f.toUpperCase()}</button>
              ))}
            </div>
          </div>
        </div>
        <p className="muted-note">
          {format === 'webm' ? 'WebM 使用 VP9 + Opus 编码（较慢，不支持硬件加速）。'
            : videoTarget ? `${format.toUpperCase()} 使用 H.264 + AAC 编码，可在设置中开启硬件加速。`
            : `将提取音频并转换为 ${format.toUpperCase()}。`}
        </p>
        <OutputHint video={format === 'mp4' || format === 'mkv'} onOpenSettings={onOpenSettings} />
      </div>

      <BatchQueue queue={queue} concurrencyKey="concurrency" startLabel="全部开始" startDisabledReason={reason}
        onStartAll={() => queue.start({ format })} />
    </>
  )
}
