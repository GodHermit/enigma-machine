import { Progress } from 'radix-ui'
import { CheckIcon } from 'lucide-react'
import type { BreakerPhase, BreakerSnapshot } from '../../lib/breaker/types'
import { cn } from '../../lib/cn'
import { formatCountShort, formatDuration } from './format'

const STEPS: { phase: BreakerPhase; label: string }[] = [
  { phase: 'rotors', label: 'Rotor order & positions' },
  { phase: 'rings', label: 'Ring settings' },
  { phase: 'plugboard', label: 'Plugboard' },
  { phase: 'words', label: 'Dictionary check' },
]

type StepState = 'done' | 'current' | 'pending'

/** 1-based index of the step the run is at (or stopped in); STEPS.length + 1 when done. */
function currentStep(snapshot: BreakerSnapshot): number {
  const { phase, phaseIndex } = snapshot.progress
  if (phase === 'done') return STEPS.length + 1
  const byPhase = STEPS.findIndex((s) => s.phase === phase)
  if (byPhase >= 0) return byPhase + 1
  return Math.max(1, Math.min(STEPS.length, phaseIndex))
}

const STATUS: Partial<Record<BreakerPhase, string>> = {
  loading: 'Starting…',
  rotors: 'Running',
  rings: 'Running',
  plugboard: 'Running',
  words: 'Running',
  done: 'Done',
  cancelled: 'Stopped',
  error: 'Failed',
}

export interface BreakerProgressProps {
  snapshot: BreakerSnapshot
  className?: string
}

/** Phase stepper, progress bar, live stats and the status line of the current / last run. */
export function BreakerProgress({ snapshot, className }: BreakerProgressProps) {
  const { progress, error } = snapshot
  const step = currentStep(snapshot)
  const stopped = progress.phase === 'cancelled' || progress.phase === 'error'
  const finished = progress.phase === 'done'
  const ratio = finished
    ? 1
    : progress.total > 0
      ? Math.min(1, Math.max(0, progress.done / progress.total))
      : 0
  const percent = Math.round(ratio * 100)
  const stepState = (index: number): StepState =>
    index < step ? 'done' : index === step && !stopped ? 'current' : 'pending'

  const stats: { label: string; value: string }[] = [
    { label: 'Keys tested', value: formatCountShort(progress.keysTested) },
    { label: 'Keys/s', value: formatCountShort(progress.keysPerSecond) },
    { label: 'Elapsed', value: formatDuration(progress.elapsedMs / 1000) },
    {
      label: 'Time left',
      value:
        finished || stopped
          ? '—'
          : progress.etaMs == null
            ? 'estimating…'
            : `about ${formatDuration(progress.etaMs / 1000)}`,
    },
    {
      label: 'Processors',
      value: progress.gpu
        ? `GPU + ${Math.max(0, (progress.workers || 1) - 1)} CPU`
        : `${progress.workers || snapshot.config?.workers || 0} CPU`,
    },
  ]
  // Proof of who did the work: rotor orders finished by each processor (each counted once).
  if (progress.gpu) {
    stats.push({ label: 'GPU', value: progress.gpu })
    stats.push({
      label: 'Rotor orders',
      value: `GPU ${progress.unitsByGpu ?? 0} · CPU ${progress.unitsByCpu ?? 0}`,
    })
  }

  return (
    <section aria-label="Progress" className={cn('flex min-w-0 flex-col', className)}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span>Progress:</span>
        <span
          className={cn(
            'text-sm font-semibold',
            progress.phase === 'error' ? 'text-signal-in' : 'text-fg',
          )}
        >
          {STATUS[progress.phase] ?? ''}
        </span>
      </div>

      <div className="rounded-md border border-border p-3 sm:p-4">
        <ol aria-label="Search phases" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STEPS.map((s, i) => {
            const state = stepState(i + 1)
            return (
              <li
                key={s.phase}
                aria-current={state === 'current' ? 'step' : undefined}
                className="flex min-w-0 flex-col items-center gap-1 text-center sm:flex-row sm:text-left"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-bold',
                    state === 'current' && 'border-primary bg-primary text-primary-fg',
                    state === 'done' && 'border-fg-emphasis text-fg',
                    state === 'pending' && 'border-border text-muted',
                  )}
                >
                  {state === 'done' ? <CheckIcon className="size-4" /> : i + 1}
                </span>
                <span
                  className={cn(
                    'min-w-0 text-sm leading-tight',
                    state === 'current' ? 'font-bold text-fg' : state === 'done' ? 'text-fg' : 'text-muted',
                  )}
                >
                  {s.label}
                  {s.phase === 'rotors' && progress.gpu && (
                    <span className="ml-1 inline-block rounded-sm border border-border px-1 text-[0.6875rem] font-semibold tracking-wide text-fg">
                      GPU
                    </span>
                  )}
                  <span className="sr-only">
                    {state === 'done' ? ' (done)' : state === 'current' ? ' (running)' : ''}
                  </span>
                </span>
              </li>
            )
          })}
        </ol>

        <Progress.Root
          value={percent}
          max={100}
          aria-label={finished ? 'Search complete' : `Phase ${Math.min(step, STEPS.length)} progress`}
          className="relative mt-4 h-3 overflow-hidden rounded-md border border-border bg-bg"
        >
          <Progress.Indicator
            className="h-full w-full bg-primary transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${100 - percent}%)` }}
          />
        </Progress.Root>

        <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-5">
          {stats.map((s) => (
            <div key={s.label} className="flex min-w-0 flex-col">
              <dt className="text-xs text-muted">{s.label}</dt>
              <dd className="truncate font-semibold tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p role="status" aria-live="polite" className="mt-1 min-h-5 text-sm text-muted">
        {progress.phase === 'cancelled' && !progress.message ? 'Search stopped.' : progress.message}
      </p>
      {progress.phase === 'error' && (
        <p role="alert" className="mt-1 text-sm font-medium text-signal-in">
          {error ?? 'The search failed.'}
        </p>
      )}
    </section>
  )
}
