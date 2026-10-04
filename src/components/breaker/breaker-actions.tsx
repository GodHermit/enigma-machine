import { useId } from 'react'
import { EllipsisVerticalIcon, RotateCcwIcon } from 'lucide-react'
import type { WorkEstimate } from '../../lib/breaker/types'
import { cn } from '../../lib/cn'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  InfoTip,
} from '../ui'
import { formatCountLong, formatDuration, plural } from './format'
import type { ProcessorPlan } from './processors'

/** Estimates above this many seconds are flagged as long. */
const LONG_RUN_SECONDS = 600

export interface BreakerActionsProps {
  canStart: boolean
  running: boolean
  /** Why "Break cipher" is disabled (shown under the row). */
  blockedReason: string | null
  estimate: WorkEstimate | null
  /** The same estimate without the GPU (shown for comparison when the GPU is used). */
  cpuEstimate?: WorkEstimate | null
  processors: ProcessorPlan
  hasGreek: boolean
  onStart(): void
  onStop(): void
  onResetForm(): void
  className?: string
}

/** The "Codebreaker:" row: Break cipher · Stop · ⋮, plus the work estimate. */
export function BreakerActions({
  canStart,
  running,
  blockedReason,
  estimate,
  cpuEstimate,
  processors,
  hasGreek,
  onStart,
  onStop,
  onResetForm,
  className,
}: BreakerActionsProps) {
  const labelId = useId()
  const long = estimate != null && estimate.seconds > LONG_RUN_SECONDS

  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-2 flex items-center gap-1">
        <span id={labelId} className="select-none">
          Codebreaker:
        </span>
        <InfoTip label="Codebreaker actions">
          <dl>
            <dt>Break cipher</dt>
            <dd>Searches for the key that turns the ciphertext into readable text. Runs in the background on your CPU cores.</dd>
            <dt>Stop</dt>
            <dd>Cancels the search; the best candidates found so far stay listed.</dd>
            <dt>⋮ Reset settings</dt>
            <dd>Restores the default search settings. The ciphertext is kept.</dd>
          </dl>
        </InfoTip>
      </div>
      <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="primary"
          className="w-full sm:w-auto sm:min-w-fit sm:flex-1"
          disabled={!canStart || running}
          onClick={onStart}
        >
          {running ? 'Breaking…' : 'Break cipher'}
        </Button>
        <div className="flex gap-2 sm:contents">
          <Button className="min-w-0 flex-1 sm:min-w-fit" disabled={!running} onClick={onStop}>
            Stop
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" aria-label="More codebreaker actions">
                <EllipsisVerticalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-60 max-w-[calc(100vw-2rem)]">
              <DropdownMenuItem icon={<RotateCcwIcon />} disabled={running} onSelect={onResetForm}>
                Reset settings to defaults
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-0.5 text-sm">
        {estimate != null && (
          <p className={cn(long ? 'font-medium text-signal-in' : 'text-muted')}>
            ≈ {formatCountLong(estimate.keys)} keys · about {formatDuration(estimate.seconds)} with{' '}
            {processors.gpu ? (
              <>
                <span className="font-semibold text-fg">{processors.gpuName}</span> + {plural(processors.cpuWorkers, 'CPU worker')}
                {cpuEstimate && <> (CPU only: about {formatDuration(cpuEstimate.seconds)})</>}
              </>
            ) : (
              plural(processors.cpuWorkers, 'worker')
            )}
            {long && (
              <>
                . That is a long search: narrow the rotors
                {hasGreek ? ', Greek wheels' : ''} or reflectors if you can.
              </>
            )}
          </p>
        )}
        {blockedReason != null && !running && <p className="text-muted">{blockedReason}</p>}
      </div>
    </div>
  )
}
