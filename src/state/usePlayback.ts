import { useEffect } from 'react'
import { useEnigmaStore } from './store'
import { useStageCount } from './derived'

/**
 * Drives signal-path playback: while `playing`, reveals one more stage every
 * `options.speed` ms. When the cursor reaches the number of stages, playback stops
 * and `stageCursor` returns to null (everything shown). Mount it once (e.g. in SignalPath).
 */
export function usePlayback(): void {
  const playing = useEnigmaStore((s) => s.playing)
  const stageCursor = useEnigmaStore((s) => s.stageCursor)
  const speed = useEnigmaStore((s) => s.options.speed)
  const pressId = useEnigmaStore((s) => s.pressId)
  const total = useStageCount()

  useEffect(() => {
    if (!playing) return
    if (total === 0) {
      useEnigmaStore.getState().pause()
      return
    }
    const timer = setTimeout(() => useEnigmaStore.getState().tick(), speed)
    return () => clearTimeout(timer)
  }, [playing, stageCursor, speed, total, pressId])
}
