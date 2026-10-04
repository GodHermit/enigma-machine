import { useId } from 'react'
import { cn } from '../../lib/cn'
import { usePlayback } from '../../state'
import { InfoTip } from '../ui'
import { Legend } from './legend'
import { PlaybackControls, TracePicker } from './playback-controls'
import { TraceList } from './trace-list'
import { WiringDiagram } from './wiring-diagram'

/** Runs the playback timer in its own leaf so ticks don't re-render the whole section. */
function PlaybackDriver() {
  usePlayback()
  return null
}

export interface SignalPathProps {
  className?: string
}

/**
 * The centrepiece: playback controls, the wiring diagram of every component with the
 * active signal path, the stage-by-stage trace and a summary of the visualised key press.
 */
export function SignalPath({ className }: SignalPathProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={cn('min-w-0 text-left', className)}>
      <PlaybackDriver />
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-1">
          <h2 id={headingId} className="text-base leading-6 font-normal text-fg">
            Signal path:
          </h2>
          <InfoTip label="Signal path" align="start" contentClassName="w-96 max-w-[min(24rem,var(--radix-popover-content-available-width))]">
            <p>
              Follows one key press through the machine: plugboard → rotors right to left → reflector
              → rotors left to right → plugboard → lamp.
            </p>
            <dl>
              <dt>‹ Key n of m ›</dt>
              <dd>Chooses which key press to show (the latest one by default).</dd>
              <dt>Play / Pause</dt>
              <dd>Reveals the path stage by stage at the chosen speed.</dd>
              <dt>Step / Back</dt>
              <dd>Moves one stage forward or backward by hand.</dd>
              <dt>Show all</dt>
              <dd>Stops playback and shows the complete path at once.</dd>
              <dt>Speed / Animate</dt>
              <dd>Time per stage, and whether each new key press plays automatically.</dd>
            </dl>
          </InfoTip>
        </div>
        <TracePicker />
      </div>
      <PlaybackControls />
      <WiringDiagram className="mt-4" />
      <Legend className="mt-2" />
      <TraceList className="mt-5" />
    </section>
  )
}

export { Legend } from './legend'
export { PlaybackControls, TracePicker } from './playback-controls'
export { TraceList, TraceSummary } from './trace-list'
export { WiringDiagram } from './wiring-diagram'
