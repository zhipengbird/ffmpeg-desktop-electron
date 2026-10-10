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
  const { settings, update, reset, exportSettings, importSettings, hw, redetect, platform } = useSettings()
  const [file, setFile] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [actionMsg, setActionMsg] = useState<{ text: string; error?: boolean } | null>(null)
  useEffect(() => { window.api.settings.path().then(setFile) }, [])

  const chooseDir = async () => {
    const dir = await window.api.openDirectory()
    if (dir) await update({ outputMode: 'custom', outputDir: dir })
  }

  const handleExport = async () => {
    setActionMsg(null)
    const res = await exportSettings()
    if (res.success && res.path) {
      setActionMsg({ text: `配置已成功导出至：${res.path}`, error: false })
    } else if (res.error) {
      setActionMsg({ text: res.error, error: true })
    }
  }

  const handleImport = async () => {
    setActionMsg(null)
    const res = await importSettings()
    if (res.success) {
      setActionMsg({ text: '配置预设已成功导入并生效！', error: false })
    } else if (res.error) {
      setActionMsg({ text: res.error, error: true })
    }
  }

  const handleReset = async () => {
    if (window.confirm('确定要恢复全部默认设置吗？')) {
      await reset()
      setActionMsg({ text: '已恢复所有选项为默认值', error: false })
    }
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
        <div className="panel-title">隐私与脱敏</div>
        <Row
          title="擦除敏感元数据 (Metadata Stripper)"
          desc="自动移除输出视频、音频与照片中的 GPS 地理坐标、拍摄设备型号、录制时间与私人注释，防止隐私泄露。"
        >
          <Toggle checked={settings.stripMetadata} onChange={(v) => update({ stripMetadata: v })} />
        </Row>
      </div>

      <div className="panel">
        <div className="panel-title">性能与防卡顿</div>
        <Row
          title="后台安静防卡顿模式 (Quiet Mode)"
          desc="降低 FFmpeg 进程系统调度优先级并限制 CPU 占用至一半核心数，转码期间前台敲代码、办公、开视频会议不卡顿，防止风扇暴鸣。"
        >
          <Toggle checked={settings.quietMode} onChange={(v) => update({ quietMode: v })} />
        </Row>
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
          title="硬件加速（全链路 GPU 解码与编码）"
          desc="针对 Apple VideoToolbox、NVIDIA CUDA/NVENC、Intel QSV、AMD AMF 与 Linux VAAPI 注入硬件解码与编码，显著降低 CPU 负载并提升吞吐。"
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

      <div className="panel">
        <div className="panel-title">预设与配置管理</div>
        <Row
          title="配置方案导入与导出"
          desc="将当前转码并发、GPU 硬件加速偏好、重名策略与安静模式等导出为 JSON 文件，或跨设备一键导入恢复。"
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={handleExport}>导出预设…</button>
            <button className="btn btn-secondary btn-sm" onClick={handleImport}>导入预设…</button>
            <button className="btn btn-ghost btn-sm" onClick={handleReset}>恢复默认设置</button>
          </div>
        </Row>
        {actionMsg && (
          <div
            style={{
              marginTop: 10,
              fontSize: 13,
              padding: '6px 12px',
              borderRadius: 6,
              background: actionMsg.error ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
              color: actionMsg.error ? '#f87171' : '#4ade80',
              border: `1px solid ${actionMsg.error ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`
            }}
          >
            {actionMsg.text}
          </div>
        )}
      </div>

      <div className="settings-footer">
        <span className="muted">设置文件：<code>{file}</code></span>
      </div>
    </>
  )
}
