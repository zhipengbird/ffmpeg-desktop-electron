import { useEffect, useState } from 'react'
import CompressPanel from './components/CompressPanel'
import ImagePanel from './components/ImagePanel'
import SeparatePanel from './components/SeparatePanel'
import ConvertPanel from './components/ConvertPanel'
import TrimPanel from './components/TrimPanel'
import InfoPanel from './components/InfoPanel'
import SettingsPanel from './components/SettingsPanel'
import { SettingsProvider } from './hooks/useSettings'
import { useQueue } from './hooks/useQueue'
import type { QueueKind } from '../shared/types'

type TabId = QueueKind | 'trim' | 'info' | 'settings'

const TABS: { id: TabId; icon: string; label: string; title: string; desc: string }[] = [
  { id: 'compress', icon: '🎬', label: '音视频压缩', title: '音视频压缩', desc: '批量压缩视频与音频，支持预设、自定义 CRF/码率与硬件加速' },
  { id: 'image', icon: '🖼️', label: '图片压缩', title: '图片压缩', desc: '批量压缩 JPG / PNG / WebP，可选输出格式与质量' },
  { id: 'separate', icon: '🔀', label: '音视频分离', title: '音视频分离', desc: '批量从视频提取音频，或导出无音轨视频' },
  { id: 'convert', icon: '🔄', label: '格式转换', title: '格式转换', desc: '在 MP4 / MKV / WebM / MP3 / AAC / WAV 间批量转换' },
  { id: 'trim', icon: '✂️', label: '裁剪截取', title: '裁剪 / 截取时长', desc: '可视化预览选取片段，支持极速（流复制）与精准（重新编码）两种模式' },
  { id: 'info', icon: 'ℹ️', label: '媒体信息', title: '获取媒体信息', desc: '查看时长、分辨率、编码、码率等详细信息' }
]

const SETTINGS_TAB = { id: 'settings' as const, icon: '⚙️', label: '设置', title: '设置', desc: '输出位置、重名处理、通知、并发与硬件加速（自动保存）' }

/** 侧边栏上的运行中任务数角标 */
function QueueBadge({ kind }: { kind: QueueKind }) {
  const { summary } = useQueue(kind)
  const n = summary.running + summary.pending
  if (!n) return null
  return <span className={`nav-badge ${summary.running ? 'active' : ''}`}>{n}</span>
}

export default function App() {
  const [tab, setTab] = useState<TabId>('compress')
  const [version, setVersion] = useState('')
  const current = tab === 'settings' ? SETTINGS_TAB : TABS.find((t) => t.id === tab)!
  const openSettings = () => setTab('settings')

  useEffect(() => {
    // 文件拖到非拖放区域时，阻止 Electron 打开该文件
    const prevent = (e: DragEvent) => { e.preventDefault() }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    window.api.appInfo().then((i) => setVersion(i.version))
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  return (
    <SettingsProvider>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="logo">🎙</div>
            <h1>媒体工具箱</h1>
          </div>
          <nav>
            {TABS.map((t) => (
              <button key={t.id} className={`nav-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                <span className="icon">{t.icon}</span>
                <span>{t.label}</span>
                {(t.id === 'compress' || t.id === 'image' || t.id === 'separate' || t.id === 'convert') && <QueueBadge kind={t.id} />}
              </button>
            ))}
          </nav>
          <nav className="nav-bottom">
            <button className={`nav-item ${tab === 'settings' ? 'active' : ''}`} onClick={openSettings}>
              <span className="icon">{SETTINGS_TAB.icon}</span>
              <span>{SETTINGS_TAB.label}</span>
            </button>
          </nav>
          <div className="sidebar-footer">媒体工具箱 v{version || '2.0'} · FFmpeg</div>
        </aside>

        <main className="main">
          <div className="main-header">
            <h2>{current.title}</h2>
            <p>{current.desc}</p>
          </div>
          <div className="main-body">
            {/* 批量面板保持挂载，切换标签不丢失参数；队列状态由主进程维护 */}
            <div hidden={tab !== 'compress'}><CompressPanel onOpenSettings={openSettings} /></div>
            <div hidden={tab !== 'image'}><ImagePanel onOpenSettings={openSettings} /></div>
            <div hidden={tab !== 'separate'}><SeparatePanel onOpenSettings={openSettings} /></div>
            <div hidden={tab !== 'convert'}><ConvertPanel onOpenSettings={openSettings} /></div>
            <div hidden={tab !== 'trim'}><TrimPanel active={tab === 'trim'} onOpenSettings={openSettings} /></div>
            {tab === 'info' && <InfoPanel />}
            {tab === 'settings' && <SettingsPanel />}
          </div>
        </main>
      </div>
    </SettingsProvider>
  )
}
