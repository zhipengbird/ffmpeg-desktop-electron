import { useCallback, useEffect, useRef, useState } from 'react'
import { uid } from '../utils/format'
import type { JobResult } from '../../shared/types'

/** 单文件任务（裁剪）状态。percent 为 null 表示不确定进度。 */
export function useJob() {
  const [running, setRunning] = useState(false)
  const [percent, setPercent] = useState<number | null>(0)
  const [timemark, setTimemark] = useState<string | undefined>()
  const [result, setResult] = useState<JobResult | null>(null)
  const jobIdRef = useRef<string | null>(null)

  useEffect(() => {
    return window.api.onProgress((ev) => {
      if (ev.jobId === jobIdRef.current) {
        setPercent(ev.percent === null ? null : Math.min(100, Math.max(0, ev.percent)))
        setTimemark(ev.timemark)
      }
    })
  }, [])

  const start = useCallback(() => {
    const id = uid()
    jobIdRef.current = id
    setRunning(true)
    setPercent(0)
    setTimemark(undefined)
    setResult(null)
    return id
  }, [])

  const finish = useCallback((res: JobResult) => {
    setRunning(false)
    if (res.ok) setPercent(100)
    setResult(res)
    jobIdRef.current = null
  }, [])

  const cancel = useCallback(async () => {
    if (jobIdRef.current) await window.api.cancelJob(jobIdRef.current)
  }, [])

  const reset = useCallback(() => {
    setResult(null)
    setPercent(0)
    setTimemark(undefined)
  }, [])

  return { running, percent, timemark, result, start, finish, cancel, reset }
}
