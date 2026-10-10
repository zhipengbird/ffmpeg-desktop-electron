import { useState } from 'react'
import FileDropzone from './FileDropzone'
import BatchQueue from './BatchQueue'
import OutputHint from './OutputHint'
import PresetGroup from './PresetGroup'
import { useQueue } from '../hooks/useQueue'

const MODES = [
  { id: 'audio', label: '提取音频（MP3）' },
  { id: 'video', label: '提取无声视频' }
] as const

export default function SeparatePanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [mode, setMode] = useState<'audio' | 'video'>('audio')
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
        <p className="muted-note">
          {mode === 'audio' ? '音频将以 192 kbps 编码为 MP3。' : '视频流直接复制（不重新编码，速度快、无损）；AVI/FLV 等输出为 MKV 以保证兼容。'}
        </p>
        <OutputHint onOpenSettings={onOpenSettings} />
      </div>

      <BatchQueue queue={queue} concurrencyKey="concurrency" startLabel="全部开始" onStartAll={() => queue.start({ mode })} />
    </>
  )
}
