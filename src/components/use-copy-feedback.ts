import { useCallback, useEffect, useRef, useState } from 'react'

export type CopyStatus = 'idle' | 'copied' | 'failed'

export interface CopyFeedback {
  /** 'copied' / 'failed' for `resetMs` after the last copy, otherwise 'idle'. */
  status: CopyStatus
  /** Writes `text` to the clipboard; resolves to whether it worked. */
  copy(text: string): Promise<boolean>
  reset(): void
}

/** Clipboard copy with a transient "Copied!" / "Copy failed" status. */
export function useCopyFeedback(resetMs = 1600): CopyFeedback {
  const [status, setStatus] = useState<CopyStatus>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  useEffect(() => clearTimer, [clearTimer])

  const reset = useCallback(() => {
    clearTimer()
    setStatus('idle')
  }, [clearTimer])

  const copy = useCallback(
    async (text: string) => {
      let ok = false
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(text)
          ok = true
        }
      } catch {
        ok = false
      }
      clearTimer()
      setStatus(ok ? 'copied' : 'failed')
      timer.current = setTimeout(() => {
        timer.current = null
        setStatus('idle')
      }, resetMs)
      return ok
    },
    [clearTimer, resetMs],
  )

  return { status, copy, reset }
}
