import { useEffect, useState } from 'react'
import { useSettings } from '../hooks/useSettings'
import type { ConflictPolicy } from '../../shared/types'

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
    >
      <span className="knob" />
    </button>
  )
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div className="setting-title">{title}</div>
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

const POLICIES: { id: ConflictPolicy; label: string }[] = [
  { id: 'rename', label: '自动加序号' },
  { id: 'overwrite', label: '覆盖' },
  { id: 'skip', label: '跳过' }
]

export default function SettingsPanel() {
  const { settings, update, reset, hw, redetect, platform } = useSettings()
  const [file, setFile] = useState('')
  const [detecting, setDetecting] = useState(false)
  useEffect(() => { window.api.settings.path().then(setFile) }, [])

  const chooseDir = async () => {
    const dir = await window.api.openDirectory()
    if (dir) await update({ outputMode: 'custom', outputDir: dir })
  }

  const working = hw.tested.filter((t) => t.ok)
  const platformName = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux'

  return (
    <>
      <div className="panel">
        <div className="panel-title">输出</div>
        <Row title="输出位置" desc={settings.outputMode === 'custom' && settings.outputDir ? settings.outputDir : '与源文件放在同一目录'}>
          <div className="preset-group">
            <button className={`preset-btn ${settings.outputMode === 'source' ? 'active' : ''}`} onClick={() => update({ outputMode: 'source' })}>源文件同目录</button>
            <button className={`preset-btn ${settings.outputMode === 'custom' ? 'active' : ''}`} onClick={() => (settings.outputDir ? update({ outputMode: 'custom' }) : chooseDir())}>自定义目录</button>
            {settings.outputMode === 'custom' && <button className="btn btn-ghost btn-sm" onClick={chooseDir}>选择文件夹…</button>}
          </div>
        </Row>
        <Row title="重名处理" desc="输出文件已存在时的处理方式（任何策略都不会覆盖源文件）">
          <div className="preset-group">
            {POLICIES.map((p) => (
              <button key={p.id} className={`preset-btn ${settings.conflictPolicy === p.id ? 'active' : ''}`} onClick={() => update({ conflictPolicy: p.id })}>{p.label}</button>
            ))}
          </div>
        </Row>
        <Row title="保留文件名后缀" desc={settings.keepSuffix ? '例：视频_压缩_平衡.mp4' : '例：视频.mp4（与源文件同名同目录时将自动加序号）'}>
          <Toggle checked={settings.keepSuffix} onChange={(v) => update({ keepSuffix: v })} />
        </Row>
      </div>

      <div className="panel">
        <div className="panel-title">完成后</div>
        <Row title="系统通知" desc="任务或批量任务完成 / 失败时发送系统通知">
          <Toggle checked={settings.notifyOnFinish} onChange={(v) => update({ notifyOnFinish: v })} />
        </Row>
        <Row title="完成后打开所在文件夹" desc="任务结束后自动在文件管理器中定位输出文件">
          <Toggle checked={settings.openFolderOnFinish} onChange={(v) => update({ openFolderOnFinish: v })} />
        </Row>
      </div>

      <div className="panel">
        <div className="panel-title">性能</div>
        <Row title="音视频并发数" desc="同时处理的音视频任务数（压缩 / 分离 / 转换），默认 2">
          <select className="select" value={settings.concurrency} onChange={(e) => update({ concurrency: Number(e.target.value) })}>
            {[1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Row>
        <Row title="图片并发数" desc="同时处理的图片任务数，默认 4">
          <select className="select" value={settings.imageConcurrency} onChange={(e) => update({ imageConcurrency: Number(e.target.value) })}>
            {[1, 2, 4, 6, 8, 12, 16].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Row>
        <Row
          title="硬件加速（视频编码）"
          desc="用于压缩、MP4/MKV 转换与精准裁剪。硬件编码速度快但同码率画质略低；运行时失败会自动回退到 libx264。"
        >
          <Toggle checked={settings.hwAccel} onChange={(v) => update({ hwAccel: v })} />
        </Row>
        {settings.hwAccel && working.length > 1 && (
          <Row title="硬件编码器" desc="自动将优先选择 H.264 编码器">
            <select className="select" value={settings.hwEncoder} onChange={(e) => update({ hwEncoder: e.target.value })}>
              <option value="auto">自动（{hw.preferred}）</option>
              {working.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
            </select>
          </Row>
        )}
        <div className="hw-box">
          <div className="hw-head">
            <span>检测到的编码器（{platformName}）</span>
            <button className="btn btn-ghost btn-xs" disabled={!hw.ready || detecting}
              onClick={async () => { setDetecting(true); await redetect(); setDetecting(false) }}>
              {hw.ready && !detecting ? '重新检测' : '检测中…'}
            </button>
          </div>
          {!hw.ready ? (
            <div className="hw-line muted">正在检测硬件编码器…</div>
          ) : (
            <>
              <div className="hw-line">
                当前使用：<strong>{settings.hwAccel && hw.preferred
                  ? (settings.hwEncoder !== 'auto' && working.some((t) => t.name === settings.hwEncoder) ? settings.hwEncoder : hw.preferred)
                  : 'libx264（软件编码）'}</strong>
              </div>
              {hw.tested.length === 0 && <div className="hw-line muted">未检测到可用的硬件编码器，将使用软件编码 libx264。{hw.error ? `（${hw.error}）` : ''}</div>}
              {hw.tested.map((t) => (
                <div className="hw-line" key={t.name} title={t.error}>
                  <span className={`dot ${t.ok ? 'ok' : 'bad'}`} /> {t.label} <code>{t.name}</code> {t.ok ? '可用' : '不可用'}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="settings-footer">
        <span className="muted">设置文件：<code>{file}</code></span>
        <button className="btn btn-ghost btn-sm" onClick={() => reset()}>恢复默认设置</button>
      </div>
    </>
  )
}
