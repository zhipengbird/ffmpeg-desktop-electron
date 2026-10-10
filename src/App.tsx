import { useState } from 'react'
import CompressPanel from './components/CompressPanel'
import ImagePanel from './components/ImagePanel'
import SeparatePanel from './components/SeparatePanel'
import ConvertPanel from './components/ConvertPanel'
import TrimPanel from './components/TrimPanel'
import InfoPanel from './components/InfoPanel'

type TabId = 'compress' | 'image' | 'separate' | 'convert' | 'trim' | 'info'

const TABS: { id: TabId; icon: string; label: string; title: string; desc: string }[] = [
  { id: 'compress', icon: '🎬', label: '音视频压缩', title: '音视频压缩', desc: '使用预设或自定义 CRF/码率压缩视频与音频' },
  { id: 'image', icon: '🖼️', label: '图片压缩', title: '图片压缩', desc: '压缩 JPG / PNG / WebP，可选输出格式与质量' },
  { id: 'separate', icon: '🔀', label: '音视频分离', title: '音视频分离', desc: '从视频提取音频，或导出无音轨视频' },
  { id: 'convert', icon: '🔄', label: '格式转换', title: '格式转换', desc: '在 MP4 / MKV / WebM / MP3 / AAC / WAV 间转换' },
  { id: 'trim', icon: '✂️', label: '裁剪截取', title: '裁剪 / 截取时长', desc: '按起止时间截取音视频片段（流复制，速度快）' },
  { id: 'info', icon: 'ℹ️', label: '媒体信息', title: '获取媒体信息', desc: '查看时长、分辨率、编码、码率等详细信息' }
]

export default function App() {
  const [tab, setTab] = useState<TabId>('compress')
  const current = TABS.find((t) => t.id === tab)!

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo">🎙</div>
          <h1>媒体工具箱</h1>
        </div>
        <nav>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`nav-item ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">媒体工具箱 v1.0 · FFmpeg</div>
      </aside>

      <main className="main">
        <div className="main-header">
          <h2>{current.title}</h2>
          <p>{current.desc}</p>
        </div>
        <div className="main-body">
          {tab === 'compress' && <CompressPanel />}
          {tab === 'image' && <ImagePanel />}
          {tab === 'separate' && <SeparatePanel />}
          {tab === 'convert' && <ConvertPanel />}
          {tab === 'trim' && <TrimPanel />}
          {tab === 'info' && <InfoPanel />}
        </div>
      </main>
    </div>
  )
}
