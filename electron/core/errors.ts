import type { ErrorCode, JobError } from '../../shared/types'

export class JobFailedError extends Error {
  readonly job: JobError
  constructor(job: JobError) {
    super(job.message)
    this.name = 'JobFailedError'
    this.job = job
  }
}

const MESSAGES: Record<ErrorCode, string> = {
  CANCELLED: '任务已取消',
  NO_SPACE: '磁盘空间不足，请清理磁盘或更换输出目录后重试',
  NOT_FOUND: '文件不存在，请确认文件未被移动或删除',
  PERMISSION: '文件被占用或无权限，请关闭占用该文件的程序或更换输出目录',
  ENCODER: '找不到编码器或编码器不可用（可尝试关闭硬件加速）',
  FORMAT: '输入格式不支持或文件已损坏',
  BINARY_MISSING: '找不到 FFmpeg 程序，请重新安装应用',
  UNKNOWN: '处理失败'
}

const RULES: { code: ErrorCode; re: RegExp }[] = [
  { code: 'NO_SPACE', re: /No space left on device|ENOSPC|disk full|磁盘空间/i },
  { code: 'PERMISSION', re: /Permission denied|EACCES|EPERM|EBUSY|resource busy|being used by another process|Operation not permitted|Read-only file system|EROFS/i },
  { code: 'NOT_FOUND', re: /No such file or directory|ENOENT|Input file is missing|does not exist|file not found/i },
  {
    code: 'ENCODER',
    re: /Unknown encoder|Encoder \S+ not found|Error while opening encoder|Could not open encoder|No NVENC capable devices|Cannot load (nvcuda|libcuda|nvEncodeAPI)|Failed to (initialise|create) (VAAPI|a VAAPI)|Error initializing output stream|encoder not available|Error setting up codec|cannot open hardware|Device creation failed|hwaccel initialisation returned error/i
  },
  {
    code: 'FORMAT',
    re: /Invalid data found when processing input|moov atom not found|could not find codec parameters|Unsupported codec|unsupported image format|Input buffer contains unsupported|Invalid NAL unit|corrupt|Premature end|VipsJpeg|VipsForeign|pngload|webpload|heifload|Unknown input format|Invalid argument|Error opening input|does not contain any stream|Output file does not contain any stream|Stream map .* matches no streams|Invalid frame dimensions|End of file|bad header|Not a JPEG/i
  }
]

/** 取日志尾部若干行（去掉进度刷屏行）。 */
export function tailLog(text: string, maxLines = 30): string {
  const lines = text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l && !/^(frame|size)=\s*\S+.*time=/.test(l.trim()))
  return lines.slice(-maxLines).join('\n')
}

export function classifyError(text: string): ErrorCode {
  for (const r of RULES) {
    if (r.re.test(text)) return r.code
  }
  return 'UNKNOWN'
}

/**
 * 把 ffmpeg / sharp / Node 错误映射为中文友好提示。
 * @param raw 错误对象、错误字符串或 stderr 文本
 * @param opts.cancelled 是否用户取消
 * @param opts.exitCode ffmpeg 退出码
 */
export function mapError(raw: unknown, opts: { cancelled?: boolean; exitCode?: number | null; stderr?: string } = {}): JobError {
  if (raw instanceof JobFailedError) return raw.job
  if (opts.cancelled) return { code: 'CANCELLED', message: MESSAGES.CANCELLED, detail: opts.stderr ? tailLog(opts.stderr) : undefined }
  const err = raw as (NodeJS.ErrnoException & { path?: string; spawnfile?: string }) | string | undefined
  let text = ''
  if (typeof err === 'string') text = err
  else if (err && typeof err === 'object') {
    text = [err.code, err.message].filter(Boolean).join(' ')
    // spawn ENOENT：ffmpeg 本身找不到
    if (err.code === 'ENOENT' && (err as { syscall?: string }).syscall?.startsWith('spawn')) {
      return { code: 'BINARY_MISSING', message: MESSAGES.BINARY_MISSING, detail: text }
    }
  }
  const full = [opts.stderr || '', text].filter(Boolean).join('\n')
  const code = classifyError(full)
  const detailParts = [tailLog(full)]
  if (typeof opts.exitCode === 'number') detailParts.push(`(退出码 ${opts.exitCode})`)
  const message = code === 'UNKNOWN'
    ? `${MESSAGES.UNKNOWN}${typeof opts.exitCode === 'number' ? `（退出码 ${opts.exitCode}）` : ''}，请展开详细日志查看原因`
    : MESSAGES[code]
  return { code, message, detail: detailParts.filter(Boolean).join('\n') || undefined }
}

export function cancelledError(): JobFailedError {
  return new JobFailedError({ code: 'CANCELLED', message: MESSAGES.CANCELLED })
}

export function friendlyMessage(code: ErrorCode): string {
  return MESSAGES[code]
}
