import { useState } from 'react'
import FileDropzone from './FileDropzone'
import BatchQueue from './BatchQueue'
import OutputHint from './OutputHint'
import PresetGroup from './PresetGroup'
import { useQueue } from '../hooks/useQueue'

const MODES = [
  { id: 'audio', label: '提取音频（MP3）' },
  { id: 'audio-copy', label: '提取原音频（无损流复制）' },
  { id: 'video', label: '提取无声视频' }
] as const

export default function SeparatePanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [mode, setMode] = useState<'audio' | 'video' | 'audio-copy'>('audio')
  const [normalizeAudio, setNormalizeAudio] = useState(false)
  const queue = useQueue('separate')

  return (
    <>
      <FileDropzone multiple onFiles={queue.add} extensions={['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'm4v', 'wmv']}
        hint="选择含音视频轨道的视频文件，可多选" compact={queue.snap.items.length > 0} />

      <div className="panel">
        <div className="panel-title">分离模式</div>
        <div className="form-row">
          <PresetGroup options={MODES} value={mode} onChange={setMode} />
        </div>
        <div className="muted-note">
          <span className="note-icon">💡</span>
          <span>
            {mode === 'audio'
              ? '音频将以 192 kbps 编码为通用 MP3 格式。'
              : mode === 'audio-copy'
                ? '直接解封装提取视频中的原音频流（AAC ➔ .m4a、Opus ➔ .opus、FLAC ➔ .flac 等），0.1 秒秒出且音质 100% 无损。'
                : '视频流直接复制（不重新编码，速度快、无损）；AVI/FLV 等输出为 MKV 以保证兼容。'}
          </span>
        </div>

        {mode === 'audio' && (
          <div className={`feature-toggle-card ${normalizeAudio ? 'active' : ''}`}>
            <div className="feature-info">
              <div className="feature-title">
                <span>🎚️ 广播级音量标准化 (EBU R128)</span>
              </div>
              <div className="feature-desc">将整体响度均衡至 -16 LUFS，消除爆音或微弱人声</div>
            </div>
            <div className="feature-control">
              <button
                type="button"
                role="switch"
                aria-checked={normalizeAudio}
                className={`toggle ${normalizeAudio ? 'on' : ''}`}
                onClick={() => setNormalizeAudio(!normalizeAudio)}
                title="开启/关闭广播级音量标准化"
              >
                <span className="knob" />
              </button>
            </div>
          </div>
        )}

        <OutputHint onOpenSettings={onOpenSettings} />
      </div>

      <BatchQueue queue={queue} concurrencyKey="concurrency" startLabel="全部开始" onStartAll={() => queue.start({ mode, normalizeAudio })} />
    </>
  )
}
