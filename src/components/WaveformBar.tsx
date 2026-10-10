import { useEffect, useRef } from 'react'

interface Props {
  peaks: number[]
  duration: number
  start: number
  end: number
  currentTime?: number
}

export default function WaveformBar({ peaks, duration, start, end, currentTime = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 获取实际像素大小以适配 Retina 视网膜高清屏
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const width = rect.width
    const height = rect.height

    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, width, height)

    if (!peaks || peaks.length === 0) {
      // 若无音频或暂未加载，绘制平滑底线
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
      ctx.fillRect(0, height / 2 - 1, width, 2)
      return
    }

    const totalBars = peaks.length
    const gap = 2
    const barWidth = Math.max(1.5, (width - (totalBars - 1) * gap) / totalBars)

    const dur = duration > 0 ? duration : 1
    const startRatio = Math.max(0, Math.min(1, start / dur))
    const endRatio = Math.max(0, Math.min(1, end / dur))
    const currentRatio = Math.max(0, Math.min(1, currentTime / dur))

    const centerY = height / 2

    for (let i = 0; i < totalBars; i++) {
      const x = i * (barWidth + gap)
      const ratio = i / totalBars
      const p = Math.max(0.08, peaks[i])
      const barHeight = Math.max(3, p * (height * 0.85))
      const y = centerY - barHeight / 2

      // 处于裁剪选中区间内
      const isSelected = ratio >= startRatio && ratio <= endRatio

      if (isSelected) {
        // 选中区：渐变青蓝高亮
        const grad = ctx.createLinearGradient(0, y, 0, y + barHeight)
        grad.addColorStop(0, '#58a6ff')
        grad.addColorStop(1, '#388bfd')
        ctx.fillStyle = grad
      } else {
        // 未选中区：低饱和暗灰
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)'
      }

      // 圆角绘制条形
      ctx.beginPath()
      const radius = Math.min(barWidth / 2, 2)
      ctx.roundRect(x, y, barWidth, barHeight, radius)
      ctx.fill()
    }

    // 绘制当前播放进度指针指示线（若大于0）
    if (currentTime > 0) {
      const playX = currentRatio * width
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.shadowColor = '#58a6ff'
      ctx.shadowBlur = 6
      ctx.beginPath()
      ctx.moveTo(playX, 0)
      ctx.lineTo(playX, height)
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  }, [peaks, duration, start, end, currentTime])

  return (
    <div className="waveform-container">
      <canvas ref={canvasRef} className="waveform-canvas" />
    </div>
  )
}
