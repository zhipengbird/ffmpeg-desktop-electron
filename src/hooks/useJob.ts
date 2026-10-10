import { useCallback, useEffect, useRef, useState } from 'react'
import { uid } from '../utils/format'

export function useJob() {
  const [jobId, setJobId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [percent, setPercent] = useState(0)
  const [timemark, setTimemark] = useState<string | undefined>()
  const [result, setResult] = useState<{ ok: boolean; message: string; output?: string } | null>(null)
  const jobIdRef = useRef<string | null>(null)

  useEffect(() => {
    const unsub = window.api.onProgress((ev) => {
      if (ev.jobId === jobIdRef.current) {
        setPercent(ev.percent)
        setTimemark(ev.timemark)
      }
    })
    return unsub
  }, [])

  const start = useCallback(() => {
    const id = uid()
    jobIdRef.current = id
    setJobId(id)
    setRunning(true)
    setPercent(0)
    setTimemark(undefined)
    setResult(null)
    return id
  }, [])

  const finish = useCallback((ok: boolean, message: string, output?: string) => {
    setRunning(false)
    setPercent(ok ? 100 : percent)
    setResult({ ok, message, output })
    jobIdRef.current = null
    setJobId(null)
  }, [percent])

  const cancel = useCallback(async () => {
    if (jobIdRef.current) {
      await window.api.cancelJob(jobIdRef.current)
      finish(false, '任务已取消')
    }
  }, [finish])

  const reset = useCallback(() => {
    setResult(null)
    setPercent(0)
    setTimemark(undefined)
  }, [])

  return { jobId, running, percent, timemark, result, start, finish, cancel, reset }
}
