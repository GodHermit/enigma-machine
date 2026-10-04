import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createBreaker } from '../../lib/breaker'
import type { Breaker, BreakerConfig, BreakerPhase, BreakerSnapshot } from '../../lib/breaker/types'
import { loadForm, saveForm } from './form-state'
import type { BreakerForm } from './form-state'

/** Snapshot shown before the first run (no breaker exists yet). */
export const IDLE_SNAPSHOT: BreakerSnapshot = {
  progress: {
    phase: 'idle',
    phaseIndex: 0,
    phaseCount: 4,
    done: 0,
    total: 0,
    keysTested: 0,
    keysPerSecond: 0,
    elapsedMs: 0,
    etaMs: null,
    workers: 0,
    message: '',
  },
  candidates: [],
  error: null,
  config: null,
}

const RUNNING: readonly BreakerPhase[] = ['loading', 'rotors', 'rings', 'plugboard', 'words']

export function isRunning(phase: BreakerPhase): boolean {
  return RUNNING.includes(phase)
}

export interface BreakerHandle {
  snapshot: BreakerSnapshot
  running: boolean
  start(config: BreakerConfig): void
  cancel(): void
  /** Set when the breaker could not be created or refused to start. */
  startError: string | null
}

const noop = () => {}

/**
 * One codebreaker per page: created on the first start (so no workers spin up before they
 * are needed), observed with useSyncExternalStore and disposed on unmount.
 */
export function useBreaker(): BreakerHandle {
  const [breaker, setBreaker] = useState<Breaker | null>(null)
  const instance = useRef<Breaker | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  const subscribe = useCallback(
    (listener: () => void) => (breaker ? breaker.subscribe(listener) : noop),
    [breaker],
  )
  const getSnapshot = useCallback(() => (breaker ? breaker.getSnapshot() : IDLE_SNAPSHOT), [breaker])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    if (!breaker) return
    return () => {
      breaker.dispose()
      if (instance.current === breaker) instance.current = null
    }
  }, [breaker])

  const start = useCallback((config: BreakerConfig) => {
    try {
      const b = instance.current ?? createBreaker()
      instance.current = b
      setBreaker(b)
      setStartError(null)
      b.start(config)
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const cancel = useCallback(() => {
    instance.current?.cancel()
  }, [])

  return { snapshot, running: isRunning(snapshot.progress.phase), start, cancel, startError }
}

/** The form state, restored from and saved to localStorage. */
export function usePersistentForm(): [BreakerForm, (update: (form: BreakerForm) => BreakerForm) => void] {
  const [form, setForm] = useState(loadForm)
  useEffect(() => {
    saveForm(form)
  }, [form])
  return [form, setForm]
}
