import type { JobSuccess, QueueItem, QueueKind, QueueSnapshot } from '../../shared/types'
import { JobFailedError, mapError } from './errors'

export interface TaskContext {
  /** 用作 ffmpeg 任务 ID（可用于 cancelJob） */
  jobId: string
  signal: AbortSignal
  onProgress: (percent: number | null, timemark?: string) => void
}

export type TaskWorker<P> = (item: Readonly<QueueItem>, params: P, ctx: TaskContext) => Promise<JobSuccess>

export interface QueueOptions<P> {
  kind: QueueKind
  concurrency: number
  worker: TaskWorker<P>
  /** 结构/状态变化（含新增、删除、状态切换） */
  onChange?: (snap: QueueSnapshot) => void
  /** 进度变化（高频） */
  onProgress?: (kind: QueueKind, id: string, percent: number | null, timemark?: string) => void
  /** 一批任务全部结束（队列从运行变为空闲） */
  onDrain?: (items: QueueItem[]) => void
  /** 取消运行中的任务时调用（例如结束 ffmpeg 进程） */
  onCancelRunning?: (item: QueueItem) => void
  sizeOf?: (p: string) => number
}

let seq = 0
function newId(kind: string): string {
  seq += 1
  return `${kind}-${Date.now().toString(36)}-${seq}`
}

/**
 * 通用任务队列：并发控制、单项取消/移除、全部开始/全部取消、清空已完成。
 * 不依赖 Electron，可直接在 Node 中测试。
 */
export class TaskQueue<P> {
  readonly kind: QueueKind
  private items: QueueItem[] = []
  private controllers = new Map<string, AbortController>()
  private params: P | null = null
  private running = false
  private concurrency: number
  private batch = new Set<string>()
  private idleWaiters: (() => void)[] = []
  /** 观测到的最大并发数（测试用） */
  maxObservedConcurrency = 0

  constructor(private readonly opts: QueueOptions<P>) {
    this.kind = opts.kind
    this.concurrency = Math.max(1, opts.concurrency)
  }

  snapshot(): QueueSnapshot {
    return { kind: this.kind, items: this.items.map((i) => ({ ...i })), running: this.running, concurrency: this.concurrency }
  }

  get(id: string): QueueItem | undefined {
    return this.items.find((i) => i.id === id)
  }

  private changed(): void {
    this.opts.onChange?.(this.snapshot())
  }

  /** 添加文件；已在队列中等待/处理中的同一文件会被忽略。 */
  add(paths: string[]): QueueItem[] {
    const added: QueueItem[] = []
    for (const p of paths) {
      if (this.items.some((i) => i.input === p && (i.status === 'pending' || i.status === 'running'))) continue
      const item: QueueItem = { id: newId(this.kind), input: p, status: 'pending', percent: 0, inputSize: this.opts.sizeOf?.(p) ?? 0 }
      this.items.push(item)
      added.push(item)
      if (this.running) this.batch.add(item.id)
    }
    if (added.length) {
      this.changed()
      this.pump()
    }
    return added
  }

  /** 全部开始：用给定参数处理所有“等待”项；运行期间新加入的项同样会被处理。 */
  start(params: P): void {
    this.params = params
    const pending = this.items.filter((i) => i.status === 'pending')
    if (!pending.length) return
    if (!this.running) this.batch.clear()
    pending.forEach((i) => this.batch.add(i.id))
    this.running = true
    this.changed()
    this.pump()
  }

  setConcurrency(n: number): void {
    this.concurrency = Math.max(1, Math.round(n))
    this.changed()
    this.pump()
  }

  cancel(id: string): boolean {
    const it = this.get(id)
    if (!it) return false
    if (it.status === 'pending') {
      this.finishItem(it, { status: 'cancelled', error: { code: 'CANCELLED', message: '任务已取消' } })
      this.checkDrain()
      return true
    }
    if (it.status === 'running') {
      this.controllers.get(id)?.abort()
      this.opts.onCancelRunning?.(it)
      return true
    }
    return false
  }

  cancelAll(): void {
    for (const it of this.items) {
      if (it.status === 'pending') this.finishItem(it, { status: 'cancelled', error: { code: 'CANCELLED', message: '任务已取消' } }, false)
    }
    for (const it of this.items) {
      if (it.status === 'running') {
        this.controllers.get(it.id)?.abort()
        this.opts.onCancelRunning?.(it)
      }
    }
    this.changed()
    this.checkDrain()
  }

  /** 移除（运行中的会先取消） */
  remove(id: string): boolean {
    const it = this.get(id)
    if (!it) return false
    if (it.status === 'running') this.cancel(id)
    this.items = this.items.filter((i) => i.id !== id)
    this.batch.delete(id)
    this.changed()
    this.checkDrain()
    return true
  }

  /** 失败/取消/跳过的项重新排队 */
  retry(id: string): boolean {
    const it = this.get(id)
    if (!it || it.status === 'pending' || it.status === 'running' || it.status === 'done') return false
    Object.assign(it, { status: 'pending', percent: 0, error: undefined, notice: undefined, output: undefined, outputSize: undefined, timemark: undefined })
    if (this.running) this.batch.add(it.id)
    this.changed()
    this.pump()
    return true
  }

  /** 清空已完成（完成/失败/已取消/已跳过） */
  clearFinished(): number {
    const before = this.items.length
    this.items = this.items.filter((i) => i.status === 'pending' || i.status === 'running')
    const n = before - this.items.length
    if (n) this.changed()
    return n
  }

  clearAll(): void {
    this.cancelAll()
    this.items = this.items.filter((i) => i.status === 'running')
    this.changed()
  }

  /** 等待当前批次结束（测试用） */
  whenIdle(): Promise<void> {
    if (!this.running && !this.items.some((i) => i.status === 'running')) return Promise.resolve()
    return new Promise((r) => this.idleWaiters.push(r))
  }

  private runningCount(): number {
    return this.items.filter((i) => i.status === 'running').length
  }

  private pump(): void {
    if (!this.running || this.params === null) return
    while (this.runningCount() < this.concurrency) {
      const next = this.items.find((i) => i.status === 'pending')
      if (!next) break
      this.launch(next, this.params)
    }
    this.checkDrain()
  }

  private launch(item: QueueItem, params: P): void {
    const ctrl = new AbortController()
    this.controllers.set(item.id, ctrl)
    item.status = 'running'
    item.percent = 0
    item.startedAt = Date.now()
    this.batch.add(item.id)
    this.maxObservedConcurrency = Math.max(this.maxObservedConcurrency, this.runningCount())
    this.changed()
    const ctx: TaskContext = {
      jobId: item.id,
      signal: ctrl.signal,
      onProgress: (percent, timemark) => {
        if (item.status !== 'running') return
        item.percent = percent === null ? null : Math.min(100, Math.max(0, percent))
        item.timemark = timemark
        this.opts.onProgress?.(this.kind, item.id, item.percent, timemark)
      }
    }
    Promise.resolve()
      .then(() => this.opts.worker({ ...item }, params, ctx))
      .then((res) => {
        if (ctrl.signal.aborted) {
          this.finishItem(item, { status: 'cancelled', error: { code: 'CANCELLED', message: '任务已取消' } })
        } else {
          this.finishItem(item, {
            status: res.skipped ? 'skipped' : 'done',
            percent: 100,
            output: res.output,
            outputSize: res.outputSize,
            inputSize: res.inputSize || item.inputSize,
            notice: res.skipped ? '目标文件已存在，已按设置跳过' : res.notice
          })
        }
      })
      .catch((err) => {
        const job = err instanceof JobFailedError ? err.job : mapError(err)
        const cancelled = ctrl.signal.aborted || job.code === 'CANCELLED'
        this.finishItem(item, cancelled
          ? { status: 'cancelled', error: { code: 'CANCELLED', message: '任务已取消' } }
          : { status: 'failed', error: job })
      })
      .finally(() => {
        this.controllers.delete(item.id)
        this.pump()
      })
  }

  private finishItem(item: QueueItem, patch: Partial<QueueItem>, emit = true): void {
    Object.assign(item, patch, { finishedAt: Date.now() })
    if (emit) this.changed()
  }

  private checkDrain(): void {
    if (!this.running) {
      if (!this.runningCount()) this.flushIdle()
      return
    }
    const active = this.items.some((i) => i.status === 'running' || i.status === 'pending')
    if (active) return
    this.running = false
    const batchItems = this.items.filter((i) => this.batch.has(i.id)).map((i) => ({ ...i }))
    this.batch.clear()
    this.changed()
    if (batchItems.length) this.opts.onDrain?.(batchItems)
    this.flushIdle()
  }

  private flushIdle(): void {
    const w = this.idleWaiters
    this.idleWaiters = []
    w.forEach((f) => f())
  }
}
