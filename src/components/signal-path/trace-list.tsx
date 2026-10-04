import { useShallow } from 'zustand/react/shallow'
import { ArrowRightIcon } from 'lucide-react'
import { toChar } from '../../lib/enigma'
import type { KeypressTrace, TraceStage } from '../../lib/enigma'
import { cn } from '../../lib/cn'
import { useActiveTrace, useEnigmaStore } from '../../state'
import { Hint, focusRing } from '../ui'
import { shortStageLabel, stageExplanation, stageTone, steppingSentence } from './geometry'

const TONE_TEXT = { in: 'text-signal-in', out: 'text-signal-out' } as const
const TONE_UNDERLINE = { in: 'border-b-signal-in', out: 'border-b-signal-out' } as const

/** Tone of the letter a stage hands on (the reflector already sends it back). */
function outputTone(stage: TraceStage) {
  return stage.kind === 'reflector' ? 'out' : stageTone(stage)
}

export interface TraceListProps {
  className?: string
}

/**
 * Ordered flow of chips K →(Plugboard) K →(ETW) K →(III) F … →(Lamp) N. The current
 * playback stage is highlighted, unrevealed hops are muted; clicking a chip jumps there.
 */
export function TraceList({ className }: TraceListProps) {
  const trace = useActiveTrace()
  const { settings, ringDisplay, cursor } = useEnigmaStore(
    useShallow((s) => ({
      settings: s.settings,
      ringDisplay: s.options.ringDisplay,
      cursor: s.stageCursor,
    })),
  )

  if (!trace) {
    return (
      <p className={cn('text-sm text-muted', className)}>
        The stage-by-stage trace appears here after the first key press.
      </p>
    )
  }

  const current = cursor === null ? -1 : cursor - 1
  const jumpTo = (stageIndex: number) => {
    const { pause, setStageCursor } = useEnigmaStore.getState()
    pause()
    setStageCursor(stageIndex + 1)
  }

  return (
    <div className={className}>
      <ol aria-label="Signal stages" className="flex flex-wrap items-end gap-x-1 gap-y-3">
        {trace.stages.map((stage, i) => {
          const revealed = cursor === null || i < cursor
          const isCurrent = i === current
          const tone = outputTone(stage)
          const label = shortStageLabel(stage, settings)
          return (
            <li
              key={i}
              className={cn('flex items-end', !revealed && 'opacity-45')}
              data-stage={i}
              data-revealed={revealed ? '' : undefined}
            >
              <span className="flex flex-col items-center px-1 pb-2">
                <span className="text-[11px] leading-4 whitespace-nowrap text-muted">{label}</span>
                {i > 0 && (
                  <ArrowRightIcon
                    aria-hidden
                    className={cn('size-4', revealed ? TONE_TEXT[stageTone(stage)] : 'text-muted')}
                  />
                )}
              </span>
              <Hint content={stageExplanation(stage, trace, settings, ringDisplay)}>
                <button
                  type="button"
                  aria-label={`Stage ${i + 1}, ${stage.label}: ${toChar(stage.input)} → ${toChar(stage.output)}`}
                  aria-current={isCurrent ? 'step' : undefined}
                  onClick={() => jumpTo(i)}
                  className={cn(
                    'inline-flex size-9 cursor-pointer items-center justify-center rounded-md border border-b-2 border-border bg-bg text-lg leading-none font-semibold text-fg transition-[border-color,box-shadow,background-color] duration-150 hover:border-border-strong',
                    focusRing,
                    revealed && TONE_UNDERLINE[tone],
                    isCurrent && 'border-fg-emphasis bg-surface-2 shadow-cell',
                    !revealed && 'border-dashed text-muted',
                  )}
                >
                  {toChar(stage.output)}
                </button>
              </Hint>
            </li>
          )
        })}
      </ol>
      <TraceSummary trace={trace} className="mt-4" />
    </div>
  )
}

/** "Key K lit lamp N. Right rotor stepped C → D; middle rotor stepped … (double step)." */
export function TraceSummary({ trace, className }: { trace: KeypressTrace; className?: string }) {
  return (
    <p className={cn('text-fg', className)} data-testid="signal-summary">
      Key <strong className="font-bold text-signal-in">{toChar(trace.input)}</strong> lit lamp{' '}
      <strong className="font-bold text-signal-out">{toChar(trace.output)}</strong>.{' '}
      {steppingSentence(trace.stepping)}
    </p>
  )
}
