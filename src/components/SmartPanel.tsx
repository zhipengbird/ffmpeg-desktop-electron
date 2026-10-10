import { useState } from 'react'
import FileDropzone from './FileDropzone'
import ProgressBar from './ProgressBar'
import ResultCard from './ResultCard'
import ErrorCard from './ErrorCard'
import OutputHint from './OutputHint'
import CompareModal from './CompareModal'
import { useJob } from '../hooks/useJob'
import { formatPreciseTime, formatSize } from '../utils/format'
import type { SilenceDetectResult } from '../../electron/core/smart'

const MEDIA_EXTS = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'm4v', 'ts', 'mp3', 'wav', 'm4a', 'aac']

type SubTab = 'jumpcut' | 'reframe'

export default function SmartPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [subTab, setSubTab] = useState<SubTab>('jumpcut')

  // 当前选中文件
  const [filePath, setFilePath] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [duration, setDuration] = useState(0)
  const [videoInfo, setVideoInfo] = useState<{ width: number; height: number; codec: string } | null>(null)

  // 智能跳剪状态
  const [detecting, setDetecting] = useState(false)
  const [detectResult, setDetectResult] = useState<SilenceDetectResult | null>(null)
  const [thresholdDb, setThresholdDb] = useState(-35)
  const [minDuration, setMinDuration] = useState(0.5)
  const [paddingSec, setPaddingSec] = useState(0.08)

  // 横转竖屏状态
  const [reframePreset, setReframePreset] = useState<'1080x1920' | '720x1280' | '2160x3840'>('1080x1920')
  const [blurRadius, setBlurRadius] = useState(25)

  // 处理任务状态
  const job = useJob()
  const [compareTarget, setCompareTarget] = useState<{ original: string; processed: string } | null>(null)

  const handleSelectFile = async (paths: string[]) => {
    const valid = paths.filter((p) => {
      const ext = p.split('.').pop()?.toLowerCase() || ''
      return MEDIA_EXTS.includes(ext)
    })
    if (!valid.length) return
    const p = valid[0]
    setFilePath(p)
    setDetectResult(null)
    job.reset()

    try {
      const [stat, probe] = await Promise.all([
        window.api.stat(p),
        window.api.probe(p)
      ])
      setFileSize(stat?.size || 0)
      const d = (probe as any)?.duration || 0
      setDuration(d)
      if ((probe as any)?.video) {
        setVideoInfo({
          width: (probe as any).video.width || 0,
          height: (probe as any).video.height || 0,
          codec: (probe as any).video.codec || 'unknown'
        })
      } else {
        setVideoInfo(null)
      }

      // 如果当前在跳剪标签，自动触发静音探测
      if (subTab === 'jumpcut') {
        triggerDetect(p, thresholdDb, minDuration)
      }
    } catch (e) {
      console.warn('读取媒体元信息失败:', e)
    }
  }

  const triggerDetect = async (targetPath = filePath, db = thresholdDb, minDur = minDuration) => {
    if (!targetPath) return
    setDetecting(true)
    try {
      const res = await window.api.detectSilence({
        input: targetPath,
        thresholdDb: db,
        minDuration: minDur
      })
      setDetectResult(res)
    } catch (err: any) {
      console.error('探测静音失败:', err)
    } finally {
      setDetecting(false)
    }
  }

  // 执行智能跳剪
  const handleStartJumpCut = async () => {
    if (!filePath) return
    const jobId = job.start()

    try {
      const res = await window.api.jumpCut({
        jobId,
        input: filePath,
        thresholdDb,
        minDuration,
        paddingSec
      })

      if (res.ok && res.output) {
        job.finish({
          ok: true,
          output: res.output,
          inputSize: fileSize,
          outputSize: res.size || 0,
          notice: `已自动切除 ${res.cutCount} 处空白停顿，节省 ${res.savedSec?.toFixed(1)} 秒`
        })
      } else {
        job.finish({
          ok: false,
          error: { code: 'UNKNOWN', message: res.error || '智能跳剪失败' }
        })
      }
    } catch (err: any) {
      job.finish({
        ok: false,
        error: { code: 'UNKNOWN', message: err.message || '跳剪处理异常' }
      })
    }
  }

  // 执行横转竖屏
  const handleStartReframe = async () => {
    if (!filePath) return
    const [w, h] = reframePreset.split('x').map(Number)
    const jobId = job.start()

    try {
      const res = await window.api.reframe({
        jobId,
        input: filePath,
        width: w,
        height: h,
        blurRadius
      })

      if (res.ok && res.output) {
        job.finish({
          ok: true,
          output: res.output,
          inputSize: fileSize,
          outputSize: res.size || 0,
          notice: `已智能重构成 ${reframePreset} 竖屏短视频，背景自适应高斯模糊`
        })
      } else {
        job.finish({
          ok: false,
          error: { code: 'UNKNOWN', message: res.error || '横转竖屏失败' }
        })
      }
    } catch (err: any) {
      job.finish({
        ok: false,
        error: { code: 'UNKNOWN', message: err.message || '横转竖屏处理异常' }
      })
    }
  }

  return (
    <div className="panel smart-panel">
      {/* 顶部子模式切换 */}
      <div className="smart-tabs" style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          className={`btn ${subTab === 'jumpcut' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => {
            setSubTab('jumpcut')
            if (filePath && !detectResult && !detecting) triggerDetect(filePath)
          }}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <span>⚡</span>
          <span>智能跳剪 (去除停顿)</span>
        </button>
        <button
          className={`btn ${subTab === 'reframe' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setSubTab('reframe')}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <span>📱</span>
          <span>横转竖屏 (9:16 短视频)</span>
        </button>
      </div>

      {/* 文件导入区域 */}
      {!filePath ? (
        <FileDropzone
          hint={subTab === 'jumpcut' ? '支持各类口播视频、会议录屏、网课或音频' : '支持各类 16:9 宽屏视频'}
          extensions={MEDIA_EXTS}
          onFiles={handleSelectFile}
          disabled={job.running}
        />
      ) : (
        <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                {filePath.split(/[\\/]/).pop()}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                大小: {formatSize(fileSize)} · 时长: {formatPreciseTime(duration)}
                {videoInfo && ` · 分辨率: ${videoInfo.width}×${videoInfo.height} (${videoInfo.codec})`}
              </div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setFilePath('')
                setDetectResult(null)
                job.reset()
              }}
              disabled={job.running}
            >
              更换文件
            </button>
          </div>
        </div>
      )}

      {/* 子功能 1: 智能跳剪工作区 */}
      {subTab === 'jumpcut' && filePath && (
        <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🔍</span> 静音停顿智能分析
            </h3>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => triggerDetect(filePath, thresholdDb, minDuration)}
              disabled={detecting || job.running}
            >
              {detecting ? '正在极速分析中...' : '重新分析'}
            </button>
          </div>

          {/* 探测统计看板 */}
          {detectResult && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '12px',
              padding: '12px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '8px',
              border: '1px solid var(--color-border)',
              marginBottom: '16px'
            }}>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>识别空白停顿</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-warning, #f59e0b)' }}>
                  {detectResult.silenceCount} <span style={{ fontSize: '12px', fontWeight: 'normal' }}>处</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>累计可切除时长</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-primary, #6366f1)' }}>
                  {detectResult.totalSilenceDuration.toFixed(1)} <span style={{ fontSize: '12px', fontWeight: 'normal' }}>秒</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>预估成片时长</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#10b981' }}>
                  {formatPreciseTime(detectResult.estimatedNewDuration)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>预计压缩提速</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#38bdf8' }}>
                  {detectResult.savedPercent}%
                </div>
              </div>
            </div>
          )}

          {/* 时间轴静音分布可视化预览条 */}
          {detectResult && detectResult.silences.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
                <span>停顿与语音分布图（灰色为切除片段，绿色为保留说话片段）：</span>
                <span>{detectResult.speechSegments.length} 个说话片段</span>
              </div>
              <div style={{
                position: 'relative',
                height: '18px',
                background: '#1e293b',
                borderRadius: '4px',
                overflow: 'hidden',
                display: 'flex'
              }}>
                {/* 说话段与静音段渲染 */}
                {detectResult.silences.map((s, idx) => {
                  const left = (s.start / detectResult.totalDuration) * 100
                  const width = Math.max(0.5, (s.duration / detectResult.totalDuration) * 100)
                  return (
                    <div
                      key={idx}
                      title={`静音停顿: ${s.start.toFixed(2)}s ~ ${s.end.toFixed(2)}s (${s.duration.toFixed(2)}s)`}
                      style={{
                        position: 'absolute',
                        left: `${left}%`,
                        width: `${width}%`,
                        height: '100%',
                        background: 'rgba(239, 68, 68, 0.75)',
                        borderLeft: '1px solid rgba(0,0,0,0.3)',
                        borderRight: '1px solid rgba(0,0,0,0.3)'
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )}

          {/* 参数调节区 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', paddingTop: '10px', borderTop: '1px solid var(--color-border)' }}>
            <div>
              <label style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                静音分贝门限: <strong>{thresholdDb} dB</strong>
              </label>
              <input
                type="range"
                min="-50"
                max="-20"
                step="1"
                value={thresholdDb}
                onChange={(e) => setThresholdDb(Number(e.target.value))}
                style={{ width: '100%' }}
                disabled={job.running}
              />
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                门限越低检测越严格，默认 -35dB
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                最短空白时长: <strong>{minDuration} 秒</strong>
              </label>
              <input
                type="range"
                min="0.2"
                max="1.5"
                step="0.1"
                value={minDuration}
                onChange={(e) => setMinDuration(Number(e.target.value))}
                style={{ width: '100%' }}
                disabled={job.running}
              />
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                超过此时长才视作停顿，默认 0.5s
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                发音保护边际: <strong>{paddingSec} 秒</strong>
              </label>
              <input
                type="range"
                min="0.02"
                max="0.2"
                step="0.02"
                value={paddingSec}
                onChange={(e) => setPaddingSec(Number(e.target.value))}
                style={{ width: '100%' }}
                disabled={job.running}
              />
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                保留前后微弱辅音防吞字，默认 0.08s
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            {!job.running ? (
              <button
                className="btn btn-primary"
                onClick={handleStartJumpCut}
                disabled={!detectResult || detectResult.silenceCount === 0}
                style={{ minWidth: '160px' }}
              >
                ⚡ 开始智能跳剪
              </button>
            ) : (
              <button className="btn btn-danger" onClick={job.cancel}>
                取消跳剪
              </button>
            )}
          </div>
        </div>
      )}

      {/* 子功能 2: 横转竖屏工作区 */}
      {subTab === 'reframe' && filePath && (
        <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>📱</span> 16:9 ➔ 9:16 短视频智能重构设置
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: '24px', alignItems: 'start' }}>
            <div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', display: 'block', marginBottom: '8px', fontWeight: 500 }}>
                  目标输出画幅规格
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { id: '1080x1920', label: '1080P 高清 (1080×1920)', desc: '抖音/小红书/视频号标准' },
                    { id: '720x1280', label: '720P 极速 (720×1280)', desc: '文件小，渲染极快' },
                    { id: '2160x3840', label: '4K 超清 (2160×3840)', desc: '极致画质' }
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`btn ${reframePreset === p.id ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ flex: 1, padding: '10px 8px', textAlign: 'center', height: 'auto', display: 'flex', flexDirection: 'column' }}
                      onClick={() => setReframePreset(p.id as any)}
                      disabled={job.running}
                    >
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>{p.label}</span>
                      <span style={{ fontSize: '11px', opacity: 0.7, marginTop: '2px' }}>{p.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', display: 'block', marginBottom: '8px', fontWeight: 500 }}>
                  背景动态高斯模糊半径: <strong>{blurRadius}</strong>
                </label>
                <input
                  type="range"
                  min="10"
                  max="60"
                  step="5"
                  value={blurRadius}
                  onChange={(e) => setBlurRadius(Number(e.target.value))}
                  style={{ width: '100%' }}
                  disabled={job.running}
                />
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                  上下填充区域采用原视频放大后动态高斯模糊填补，画面灵动不呆板且主体保持居中。
                </div>
              </div>

              <div style={{ marginTop: '24px' }}>
                {!job.running ? (
                  <button
                    className="btn btn-primary"
                    onClick={handleStartReframe}
                    style={{ minWidth: '180px' }}
                  >
                    📱 一键重构为竖屏
                  </button>
                ) : (
                  <button className="btn btn-danger" onClick={job.cancel}>
                    取消重构
                  </button>
                )}
              </div>
            </div>

            {/* 视觉示意图 */}
            <div style={{
              background: '#0b0f19',
              borderRadius: '12px',
              padding: '12px',
              border: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center'
            }}>
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
                9:16 构图效果示意
              </div>
              <div style={{
                width: '120px',
                height: '213px',
                borderRadius: '8px',
                border: '2px solid rgba(255,255,255,0.2)',
                position: 'relative',
                overflow: 'hidden',
                background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {/* 模糊背景示意 */}
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'radial-gradient(circle, rgba(99,102,241,0.3) 0%, rgba(15,23,42,0.8) 100%)',
                  filter: `blur(${Math.round(blurRadius / 10)}px)`
                }} />
                {/* 前景视频居中 */}
                <div style={{
                  position: 'relative',
                  width: '100%',
                  height: '67.5px', // 120 * (9/16)
                  background: 'rgba(99,102,241,0.85)',
                  borderRadius: '2px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '11px',
                  fontWeight: 600
                }}>
                  原视频画面
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 进度卡片 */}
      {job.running && (
        <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
          <ProgressBar
            percent={job.percent}
            timemark={job.timemark}
            label={subTab === 'jumpcut' ? '正在智能跳剪与拼接合成...' : '正在渲染竖屏动态模糊背景...'}
          />
        </div>
      )}

      {/* 失败卡片 */}
      {job.result && !job.result.ok && (
        <div style={{ marginBottom: '16px' }}>
          <ErrorCard
            title={subTab === 'jumpcut' ? '跳剪失败' : '重构失败'}
            error={job.result.error}
          />
        </div>
      )}

      {/* 完成结果卡片 */}
      {job.result && job.result.ok && (
        <div style={{ marginBottom: '16px' }}>
          <ResultCard
            output={job.result.output}
            inputSize={job.result.inputSize}
            outputSize={job.result.outputSize}
            notice={job.result.notice}
            onDismiss={job.reset}
            onCompare={videoInfo ? () => setCompareTarget({ original: filePath, processed: (job.result as any).output }) : undefined}
          />
        </div>
      )}

      <OutputHint onOpenSettings={onOpenSettings} />

      {/* 质感对比 Modal */}
      {compareTarget && (
        <CompareModal
          original={compareTarget.original}
          processed={compareTarget.processed}
          onClose={() => setCompareTarget(null)}
        />
      )}
    </div>
  )
}
