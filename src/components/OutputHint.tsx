import { useSettings } from '../hooks/useSettings'

const POLICY: Record<string, string> = { rename: '自动加序号', overwrite: '覆盖', skip: '跳过' }

export default function OutputHint({ video, onOpenSettings }: { video?: boolean; onOpenSettings?: () => void }) {
  const { settings, hw } = useSettings()
  const encoder = video
    ? settings.hwAccel
      ? !hw.ready
        ? '硬件加速（检测中…）'
        : hw.tested.some((t) => t.ok)
          ? `硬件加速：${settings.hwEncoder !== 'auto' && hw.tested.some((t) => t.ok && t.name === settings.hwEncoder) ? settings.hwEncoder : hw.preferred}`
          : '硬件加速不可用，使用 libx264'
      : '软件编码 libx264'
    : null
  return (
    <div className="output-hint">
      <span>📁 输出：{settings.outputMode === 'custom' && settings.outputDir ? settings.outputDir : '源文件同目录'}</span>
      <span>重名：{POLICY[settings.conflictPolicy]}</span>
      {encoder && <span>🎞 {encoder}</span>}
      {onOpenSettings && <button className="link-btn" onClick={onOpenSettings}>修改设置</button>}
    </div>
  )
}
