import { useShallow } from 'zustand/react/shallow'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  PauseIcon,
  PlayIcon,
  StepBackIcon,
  StepForwardIcon,
} from 'lucide-react'
import { toChar } from '../../lib/enigma'
import { cn } from '../../lib/cn'
import {
  SPEED_MAX,
  SPEED_MIN,
  selectResult,
  useActiveTrace,
  useActiveTraceIndex,
  useEnigmaStore,
  useStageCount,
} from '../../state'
import { Button, InfoTip, Slider, Switch } from '../ui'

export interface PlaybackControlsProps {
  className?: string
}

/** Slider position ↔ ms per stage: the slider runs slow → fast (left → right). */
function speedToSlider(ms: number): number {
  return SPEED_MIN + SPEED_MAX - ms
}

/** [Play/Pause] [Step] [Back] [Show all] · Speed · Animate · stage counter. */
export function PlaybackControls({ className }: PlaybackControlsProps) {
  const { playing, cursor, animate, speed } = useEnigmaStore(
    useShallow((s) => ({
      playing: s.playing,
      cursor: s.stageCursor,
      animate: s.options.animate,
      speed: s.options.speed,
    })),
  )
  const total = useStageCount()
  const empty = total === 0
  const revealed = cursor ?? total
  const { play, pause, stepStage, setStageCursor, setOption } = useEnigmaStore.getState()

  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-3', className)}>
      <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
        <Button
          variant="primary"
          className="col-span-3 sm:w-32"
          disabled={empty}
          onClick={() => (playing ? pause() : play())}
        >
          {playing ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Button disabled={empty} onClick={() => stepStage(1)}>
          <StepForwardIcon aria-hidden />
          Step
        </Button>
        <Button disabled={empty || cursor === 0} onClick={() => stepStage(-1)}>
          <StepBackIcon aria-hidden />
          Back
        </Button>
        <Button
          disabled={empty || (cursor === null && !playing)}
          onClick={() => {
            pause()
            setStageCursor(null)
          }}
        >
          <EyeIcon aria-hidden />
          Show all
        </Button>
      </div>

      {/* Needs ~20rem beside the buttons; on narrower containers it wraps onto its own line. */}
      <div className="flex min-w-0 flex-[1_1_20rem] flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="text-sm text-muted">
            Speed
          </span>
          <Slider
            className="w-28"
            aria-label="Speed"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={10}
            value={[speedToSlider(speed)]}
            onValueChange={([v]) => setOption('speed', speedToSlider(v))}
          />
          <span className="w-14 text-sm text-muted tabular-nums">{speed} ms</span>
          <InfoTip label="Speed" className="-ml-2">
            Time spent on each stage of the signal path during playback. Right is faster.
          </InfoTip>
        </div>
        <Switch
          label="Animate"
          info="When on, every new key press plays the signal path stage by stage. When off, the whole path is shown at once."
          checked={animate}
          onCheckedChange={(v) => setOption('animate', v)}
        />
        <p className="ml-auto text-sm whitespace-nowrap text-muted tabular-nums">
          {empty ? 'No stages yet' : `Stage ${revealed} of ${total}`}
        </p>
      </div>
    </div>
  )
}

export interface TracePickerProps {
  className?: string
}

/** "‹ Key 5 of 12: K → N ›" — chooses which key press is visualised. */
export function TracePicker({ className }: TracePickerProps) {
  const count = useEnigmaStore((s) => selectResult(s).traces.length)
  const index = useActiveTraceIndex()
  const trace = useActiveTrace()
  const selectTrace = useEnigmaStore((s) => s.selectTrace)

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Button
        size="icon-sm"
        aria-label="Previous key press"
        disabled={index === null || index <= 0}
        onClick={() => index !== null && selectTrace(index - 1)}
      >
        <ChevronLeftIcon aria-hidden />
      </Button>
      <span className="min-w-[9.5rem] text-center text-sm tabular-nums" data-testid="trace-picker-label">
        {trace && index !== null ? (
          <>
            Key {index + 1} of {count}:{' '}
            <strong className="font-bold text-signal-in">{toChar(trace.input)}</strong> →{' '}
            <strong className="font-bold text-signal-out">{toChar(trace.output)}</strong>
          </>
        ) : (
          <span className="text-muted">No key pressed yet</span>
        )}
      </span>
      <Button
        size="icon-sm"
        aria-label="Next key press"
        disabled={index === null || index >= count - 1}
        onClick={() => index !== null && selectTrace(index + 1)}
      >
        <ChevronRightIcon aria-hidden />
      </Button>
    </div>
  )
}
