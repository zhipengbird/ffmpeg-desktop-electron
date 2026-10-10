import { useState } from 'react'
import FileDropzone from './FileDropzone'
import { formatBitrate, formatDuration, formatSize, isImage } from '../utils/format'

interface InfoItem {
  label: string
  value: string
}

export default function InfoPanel() {
  const [file, setFile] = useState<string | null>(null)
  const [items, setItems] = useState<InfoItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (p: string) => {
    setFile(p)
    setLoading(true)
    setError(null)
    setItems([])
    try {
      if (isImage(p)) {
        const info = await window.api.imageInfo(p)
        if ('error' in info) {
          setError(String(info.error))
          return
        }
        setItems([
          { label: '格式', value: String(info.format).toUpperCase() },
          { label: '宽度', value: `${info.width} px` },
          { label: '高度', value: `${info.height} px` },
          { label: '文件大小', value: formatSize(info.size as number) }
        ])
      } else {
        const info = await window.api.probe(p)
        if ('error' in info) {
          setError(String(info.error))
          return
        }
        const list: InfoItem[] = [
          { label: '容器格式', value: String(info.format).toUpperCase() },
          { label: '时长', value: formatDuration(info.duration as number) },
          { label: '文件大小', value: formatSize(info.size as number) },
          { label: '总码率', value: formatBitrate(info.bitrate as number) }
        ]
        const video = info.video as { codec: string; width: number; height: number; fps: number; bitrate: number } | undefined
        const audio = info.audio as { codec: string; sampleRate: number; channels: number; bitrate: number } | undefined
        if (video) {
          list.push(
            { label: '视频编码', value: video.codec },
            { label: '分辨率', value: `${video.width}×${video.height}` },
            { label: '帧率', value: `${video.fps} fps` },
            { label: '视频码率', value: formatBitrate(video.bitrate) }
          )
        }
        if (audio) {
          list.push(
            { label: '音频编码', value: audio.codec },
            { label: '采样率', value: `${audio.sampleRate} Hz` },
            { label: '声道数', value: String(audio.channels) },
            { label: '音频码率', value: formatBitrate(audio.bitrate) }
          )
        }
        setItems(list)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <FileDropzone
        file={file}
        onFile={load}
        onClear={() => { setFile(null); setItems([]); setError(null) }}
        hint="选择任意音视频或图片查看详细信息"
      />

      {loading && <p style={{ marginTop: 16, color: 'var(--text-muted)' }}>正在读取媒体信息…</p>}
      {error && (
        <div className="result-banner err" style={{ marginTop: 16 }}>
          <span>✕</span>
          <div className="msg">{error}</div>
        </div>
      )}

      {items.length > 0 && (
        <div className="panel">
          <div className="panel-title">媒体信息</div>
          <div className="info-grid">
            {items.map((it) => (
              <div className="info-item" key={it.label}>
                <div className="label">{it.label}</div>
                <div className="value">{it.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
