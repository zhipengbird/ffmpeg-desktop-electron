import { useCallback, useEffect, useMemo, useState } from 'react'
import { summarizeItems, type QueueKind, type QueueSnapshot } from '../../shared/types'

export function useQueue(kind: QueueKind) {
  const [snap, setSnap] = useState<QueueSnapshot>({ kind, items: [], running: false, concurrency: 1 })

  useEffect(() => {
    let alive = true
    window.api.queue.snapshot(kind).then((s) => { if (alive) setSnap(s) })
    const offChanged = window.api.queue.onChanged((s) => { if (s.kind === kind) setSnap(s) })
    const offProgress = window.api.queue.onProgress((e) => {
      if (e.kind !== kind) return
      setSnap((prev) => ({
        ...prev,
        items: prev.items.map((it) => (it.id === e.id && it.status === 'running' ? { ...it, percent: e.percent, timemark: e.timemark } : it))
      }))
    })
    return () => { alive = false; offChanged(); offProgress() }
  }, [kind])

  const summary = useMemo(() => summarizeItems(snap.items), [snap.items])

  const add = useCallback((paths: string[]) => window.api.queue.add(kind, paths), [kind])
  const start = useCallback((params: Record<string, unknown>) => window.api.queue.start(kind, params), [kind])
  const cancel = useCallback((id: string) => window.api.queue.cancel(kind, id), [kind])
  const cancelAll = useCallback(() => window.api.queue.cancelAll(kind), [kind])
  const remove = useCallback((id: string) => window.api.queue.remove(kind, id), [kind])
  const retry = useCallback((id: string) => window.api.queue.retry(kind, id), [kind])
  const clearFinished = useCallback(() => window.api.queue.clearFinished(kind), [kind])
  const clearAll = useCallback(() => window.api.queue.clearAll(kind), [kind])

  return { snap, summary, add, start, cancel, cancelAll, remove, retry, clearFinished, clearAll }
}

export type QueueApi = ReturnType<typeof useQueue>
