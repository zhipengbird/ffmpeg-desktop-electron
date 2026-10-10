import path from 'path'
import fs from 'fs'
import type { ConflictPolicy } from '../../shared/types'

export interface NamingOptions {
  outputMode: 'source' | 'custom'
  outputDir: string
  conflictPolicy: ConflictPolicy
  keepSuffix: boolean
}

export interface OutputDecision {
  path: string
  /** 冲突策略为“跳过”且目标已存在 */
  skip: boolean
  /** 目标原本已存在 */
  existed: boolean
}

const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'

function norm(p: string): string {
  const r = path.resolve(p)
  return caseInsensitive ? r.toLowerCase() : r
}

/** 进程内“已预留”的输出路径，防止并发任务写同一个文件。 */
export class PathReservations {
  private set = new Set<string>()
  has(p: string): boolean { return this.set.has(norm(p)) }
  add(p: string): void { this.set.add(norm(p)) }
  release(p: string): void { this.set.delete(norm(p)) }
  clear(): void { this.set.clear() }
}

export function outputDirFor(input: string, opts: Pick<NamingOptions, 'outputMode' | 'outputDir'>): string {
  return opts.outputMode === 'custom' && opts.outputDir ? opts.outputDir : path.dirname(input)
}

/**
 * 计算输出路径并应用冲突策略：
 * - rename（自动加序号）：name (1).ext、name (2).ext …
 * - overwrite（覆盖）：直接使用目标路径
 * - skip（跳过）：目标存在则返回 skip=true
 * 无论何种策略都绝不会覆盖输入文件本身，也不会与正在进行的任务撞名。
 */
export function decideOutputPath(
  input: string,
  suffix: string,
  ext: string,
  opts: NamingOptions,
  reserved?: PathReservations
): OutputDecision {
  const dir = outputDirFor(input, opts)
  const base = path.basename(input, path.extname(input))
  const name = opts.keepSuffix && suffix ? `${base}_${suffix}` : base
  const first = path.join(dir, `${name}${ext}`)
  const isInput = (p: string) => norm(p) === norm(input)
  const taken = (p: string) => isInput(p) || fs.existsSync(p) || !!reserved?.has(p)
  const existed = fs.existsSync(first)

  let chosen = first
  if (taken(first)) {
    const mustRename = isInput(first) || !!reserved?.has(first)
    if (!mustRename && opts.conflictPolicy === 'skip') {
      return { path: first, skip: true, existed }
    }
    if (mustRename || opts.conflictPolicy === 'rename') {
      for (let n = 1; n < 10000; n++) {
        const cand = path.join(dir, `${name} (${n})${ext}`)
        if (!taken(cand)) { chosen = cand; break }
      }
    }
  }
  reserved?.add(chosen)
  return { path: chosen, skip: false, existed }
}
