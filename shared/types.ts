/**
 * 主进程与渲染进程共享的纯类型 / 纯函数（不得依赖 Node 或 DOM）。
 */

export type QualityPreset = 'high' | 'balanced' | 'small'

export type ConflictPolicy = 'rename' | 'overwrite' | 'skip'

export type QueueKind = 'compress' | 'image' | 'separate' | 'convert'

export type ItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'skipped'

export type ErrorCode =
  | 'CANCELLED'
  | 'NO_SPACE'
  | 'NOT_FOUND'
  | 'PERMISSION'
  | 'ENCODER'
  | 'FORMAT'
  | 'BINARY_MISSING'
  | 'UNKNOWN'

export interface JobError {
  code: ErrorCode
  /** 友好的中文提示 */
  message: string
  /** 原始日志尾部（stderr 等） */
  detail?: string
}

export interface JobSuccess {
  ok: true
  output: string
  inputSize: number
  outputSize: number
  /** 附加提示，例如硬件编码回退 */
  notice?: string
  /** 实际使用的视频编码器 */
  encoder?: string
  skipped?: boolean
}

export interface JobFailure {
  ok: false
  error: JobError
}

export type JobResult = JobSuccess | JobFailure

export interface Settings {
  /** 输出位置：源文件同目录 / 自定义目录 */
  outputMode: 'source' | 'custom'
  outputDir: string
  conflictPolicy: ConflictPolicy
  /** 输出文件名是否保留功能后缀（如 _压缩_balanced） */
  keepSuffix: boolean
  notifyOnFinish: boolean
  openFolderOnFinish: boolean
  /** 音视频任务并发数 */
  concurrency: number
  /** 图片任务并发数 */
  imageConcurrency: number
  hwAccel: boolean
  /** 'auto' 或具体硬件编码器名 */
  hwEncoder: string
  /** 隐私脱敏：是否擦除 GPS 坐标、相机设备、录制时间等元数据 */
  stripMetadata: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  outputMode: 'source',
  outputDir: '',
  conflictPolicy: 'rename',
  keepSuffix: true,
  notifyOnFinish: true,
  openFolderOnFinish: false,
  concurrency: 2,
  imageConcurrency: 4,
  hwAccel: false,
  hwEncoder: 'auto',
  stripMetadata: false
}

export interface EncoderTest {
  name: string
  label: string
  ok: boolean
  error?: string
}

export interface EncoderInfo {
  /** 检测是否完成 */
  ready: boolean
  platform: string
  /** ffmpeg -encoders 中出现的候选硬件编码器 */
  listed: string[]
  /** 实测结果 */
  tested: EncoderTest[]
  /** 首选可用的硬件 H.264 编码器；无则 null */
  preferred: string | null
  error?: string
}

export interface QueueItem {
  id: string
  input: string
  status: ItemStatus
  /** 0–100；null 表示时长未知（不确定进度） */
  percent: number | null
  timemark?: string
  inputSize: number
  outputSize?: number
  output?: string
  error?: JobError
  notice?: string
  startedAt?: number
  finishedAt?: number
}

export interface QueueSnapshot {
  kind: QueueKind
  items: QueueItem[]
  running: boolean
  concurrency: number
}

export interface ProgressEvent {
  jobId: string
  percent: number | null
  timemark?: string
}

export interface BatchSummary {
  total: number
  pending: number
  running: number
  done: number
  failed: number
  cancelled: number
  skipped: number
  inputBytes: number
  outputBytes: number
  savedBytes: number
  /** 体积变化百分比（负数为减少） */
  changePercent: number
}

/** 计算体积变化百分比（负数表示减少）。 */
export function sizeChangePercent(before: number, after: number): number {
  if (!before || before <= 0) return 0
  return ((after - before) / before) * 100
}

export function summarizeItems(items: QueueItem[]): BatchSummary {
  const s: BatchSummary = {
    total: items.length, pending: 0, running: 0, done: 0, failed: 0, cancelled: 0, skipped: 0,
    inputBytes: 0, outputBytes: 0, savedBytes: 0, changePercent: 0
  }
  for (const it of items) {
    s[it.status === 'pending' ? 'pending'
      : it.status === 'running' ? 'running'
      : it.status === 'done' ? 'done'
      : it.status === 'failed' ? 'failed'
      : it.status === 'cancelled' ? 'cancelled' : 'skipped']++
    if (it.status === 'done' && typeof it.outputSize === 'number') {
      s.inputBytes += it.inputSize
      s.outputBytes += it.outputSize
    }
  }
  s.savedBytes = s.inputBytes - s.outputBytes
  s.changePercent = sizeChangePercent(s.inputBytes, s.outputBytes)
  return s
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  pending: '等待',
  running: '处理中',
  done: '完成',
  failed: '失败',
  cancelled: '已取消',
  skipped: '已跳过'
}
