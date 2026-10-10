import { useState } from 'react'
import FileDropzone from './FileDropzone'
import BatchQueue from './BatchQueue'
import OutputHint from './OutputHint'
import { useQueue } from '../hooks/useQueue'
import { isAudio } from '../utils/format'

const VIDEO_FORMATS = ['mp4', 'mkv', 'webm', 'gif', 'webp']
const AUDIO_FORMATS = ['mp3', 'aac', 'wav']

const GIF_FPS_OPTIONS = [10, 15, 24]
const GIF_WIDTH_OPTIONS = [
  { val: 320, label: '320 px (表情包/极小)' },
  { val: 480, label: '480 px (标清推荐)' },
  { val: 640, label: '640 px (高清)' },
  { val: 0, label: '原始尺寸' }
]

export default function ConvertPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [format, setFormat] = useState('mp4')
  const [gifFps, setGifFps] = useState(15)
  const [gifWidth, setGifWidth] = useState(480)
  const [normalizeAudio, setNormalizeAudio] = useState(false)
  const queue = useQueue('convert')
  const pendingInputs = queue.snap.items.filter((i) => i.status === 'pending').map((i) => i.input)
  const hasAudioInput = pendingInputs.some(isAudio)
  const videoTarget = VIDEO_FORMATS.includes(format)
  const isAnim = format === 'gif' || format === 'webp'
  const reason = hasAudioInput && videoTarget ? '列表中包含纯音频文件，无法转换为视频或动图格式；请选择音频格式或移除这些文件' : undefined

  const onFiles = (paths: string[]) => {
    queue.add(paths)
    if (paths.length && paths.every(isAudio) && videoTarget && !queue.snap.items.length) setFormat('mp3')
  }

  const startAll = () => {
    queue.start({
      format,
      gifFps: isAnim ? gifFps : undefined,
      gifWidth: isAnim ? gifWidth : undefined,
      normalizeAudio: !isAnim ? normalizeAudio : undefined
    })
  }

  return (
    <>
      <FileDropzone multiple onFiles={onFiles}
        extensions={['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'm4v', 'wmv', 'mp3', 'aac', 'wav', 'm4a', 'flac', 'ogg', 'opus']}
        hint="视频可转为 MP4/MKV/WebM/GIF/WebP 或提取音频；音频可转为 MP3/AAC/WAV；可多选" compact={queue.snap.items.length > 0} />

      <div className="panel">
        <div className="panel-title">目标格式</div>
        <div className="form-row">
          <div className="form-group">
            <label>视频 / 动图</label>
            <div className="preset-group">
              {VIDEO_FORMATS.map((f) => (
                <button key={f} className={`preset-btn ${format === f ? 'active' : ''}`} onClick={() => setFormat(f)}>
                  {f === 'gif' ? 'GIF 动图' : f === 'webp' ? 'WEBP 动图' : f.toUpperCase()}
                </button>
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

        {isAnim && (
          <div className="form-row gif-config-row" style={{ marginTop: 6, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
            <div className="form-group">
              <label>动图帧率 (FPS)</label>
              <div className="preset-group">
                {GIF_FPS_OPTIONS.map((fps) => (
                  <button key={fps} className={`preset-btn ${gifFps === fps ? 'active' : ''}`} onClick={() => setGifFps(fps)}>
                    {fps} fps
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>缩放宽度</label>
              <select value={gifWidth} onChange={(e) => setGifWidth(Number(e.target.value))}>
                {GIF_WIDTH_OPTIONS.map((opt) => (
                  <option key={opt.val} value={opt.val}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="muted-note">
          <span className="note-icon">💡</span>
          <span>
            {format === 'gif' ? '采用调色板生成与差分抖动引擎（palettegen + paletteuse），画面平滑无噪点，体积紧凑。'
              : format === 'webp' ? '采用现代 WebP 动画编码引擎（libwebp），支持 1670 万真彩色与平滑循环，体积比 GIF 小 30%～50%。'
              : format === 'webm' ? 'WebM 使用 VP9 + Opus 编码（较慢，不支持硬件加速）。'
              : videoTarget ? `${format.toUpperCase()} 使用 H.264 + AAC 编码，可在设置中开启硬件加速。`
              : `将提取音频并转换为 ${format.toUpperCase()}。`}
          </span>
        </div>

        {!isAnim && (
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

        <OutputHint video={format === 'mp4' || format === 'mkv'} onOpenSettings={onOpenSettings} />
      </div>

      <BatchQueue queue={queue} concurrencyKey="concurrency" startLabel="全部开始" startDisabledReason={reason}
        onStartAll={startAll} />
    </>
  )
}
