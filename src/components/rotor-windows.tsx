import { useEffect, useRef, useState } from 'react'
import type { ComponentProps, KeyboardEvent, ReactNode } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useShallow } from 'zustand/react/shallow'
import { REFLECTORS, mod26, ringLabel, toChar } from '../lib/enigma'
import type { ReflectorId, SlotId } from '../lib/enigma'
import { cn } from '../lib/cn'
import { selectActiveTrace, selectCurrentPositions, selectResult, useEnigmaStore } from '../state'
import { DrumLetters, Thumbwheel } from './rotor-drum'
import { useRatchetDrum } from './use-ratchet-drum'
import { Badge, Button, Cell, Hint, InfoTip } from './ui'

type MainSlot = Exclude<SlotId, 'greek'>
type SteppedFlags = Record<MainSlot, boolean>

/** How long a stepped rotor window stays highlighted after a key press. */
export const STEP_FLASH_MS = 450

/** Wheel distance (px) that equals one notch of the rotor. */
const WHEEL_STEP_PX = 50

const SLOT_NAMES: Record<SlotId, string> = {
  greek: 'Greek',
  left: 'Left',
  middle: 'Middle',
  right: 'Right',
}

/*
 * Responsive sizing: 44px cells below `sm`, the reference's 58px tape cells above.
 * The column is five stacked cells with collapsed (-2px) borders; the drum of
 * letters shows through the middle three. --pitch is the letter spacing,
 * --drum-top / --drum-height locate the three window cells.
 */
const cellSize = 'size-11 text-lg sm:size-[58px] sm:text-2xl'
const drumHeight = 'h-[212px] sm:h-[282px]'
const drumVars =
  '[--pitch:42px] [--drum-top:42px] [--drum-height:128px] sm:[--pitch:56px] sm:[--drum-top:56px] sm:[--drum-height:170px]'

/** Joins direct children vertically like a Bootstrap input-group (collapsed borders, outer radius only). */
const joinedColumn =
  '[&>*]:relative [&>*]:rounded-none [&>*:first-child]:rounded-t-md [&>*:last-child]:rounded-b-md [&>*:not(:first-child)]:-mt-0.5 [&>*:hover]:z-[5] [&>*:focus-visible]:z-20'

/** The flash shown around a window whose rotor stepped on the latest key press. */
const flashRing = 'ring-2 ring-fg-emphasis ring-offset-2 ring-offset-bg'

function slotAriaName(slot: SlotId, rotor: string): string {
  return slot === 'greek' ? `Greek wheel (${rotor})` : `${SLOT_NAMES[slot]} rotor (${rotor})`
}

/** Lets the mouse wheel / trackpad turn a rotor (non-passive so the page does not scroll). */
function useWheelNudge(slot: SlotId) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let accumulated = 0
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return
      event.preventDefault()
      const px = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      if (Math.sign(px) !== Math.sign(accumulated)) accumulated = 0
      accumulated += px
      const notches = Math.trunc(accumulated / WHEEL_STEP_PX)
      if (notches === 0) return
      accumulated -= notches * WHEEL_STEP_PX
      useEnigmaStore.getState().nudgePosition(slot, notches)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [slot])

  return ref
}

/** Which rotors stepped on the latest key press (cleared after STEP_FLASH_MS). */
function useStepFlash(): SteppedFlags | null {
  const [flash, setFlash] = useState<{ id: number; stepped: SteppedFlags } | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = useEnigmaStore.subscribe((state, prev) => {
      if (state.pressId === prev.pressId) return
      const trace = selectActiveTrace(state)
      if (!trace) return
      const id = state.pressId
      setFlash({ id, stepped: { ...trace.stepping.stepped } })
      clearTimeout(timer)
      timer = setTimeout(() => {
        setFlash((current) => (current?.id === id ? null : current))
      }, STEP_FLASH_MS)
    })
    return () => {
      unsubscribe()
      clearTimeout(timer)
    }
  }, [])

  return flash?.stepped ?? null
}

interface ColumnProps {
  caption: ReactNode
  slotName: string
  children: ReactNode
}

function Column({ caption, slotName, children }: ColumnProps) {
  return (
    // Fixed width (wider than any caption, e.g. "VIII · 26") so the strip never
    // reflows when a rotor, ring setting or letter changes.
    <div className="flex w-14 shrink-0 flex-col items-center sm:w-20">
      {children}
      <div className="mt-2 w-full text-center text-xs leading-4 whitespace-nowrap text-muted tabular-nums">
        <div className="font-semibold text-fg">{caption}</div>
        <div>{slotName}</div>
      </div>
    </div>
  )
}

function ReflectorWindow({ reflector }: { reflector: ReflectorId }) {
  const spec = REFLECTORS[reflector]
  const letter = reflector.charAt(4)
  return (
    <Column caption="UKW" slotName="Reflector">
      <div className={cn('flex flex-col justify-center', drumHeight)}>
        <Cell
          role="img"
          aria-label={`Reflector ${spec.name}`}
          className={cn(cellSize, 'flex-col bg-surface')}
        >
          <span aria-hidden="true">{letter}</span>
          {spec.thin && (
            <span aria-hidden="true" className="mt-0.5 text-[0.625rem] leading-none text-muted">
              thin
            </span>
          )}
        </Cell>
      </div>
    </Column>
  )
}

interface RotorWindowProps {
  slot: SlotId
  flashing: boolean
}

function RotorWindow({ slot, flashing }: RotorWindowProps) {
  const config = useEnigmaStore(
    useShallow((s) => {
      const r = s.settings[slot]
      return r ? { rotor: r.rotor, ring: r.ring, start: r.position } : null
    }),
  )
  const position = useEnigmaStore((s) => selectCurrentPositions(s)[slot] ?? 0)
  const ringDisplay = useEnigmaStore((s) => s.options.ringDisplay)
  const nudgePosition = useEnigmaStore((s) => s.nudgePosition)
  const wheelRef = useWheelNudge(slot)
  const drumRef = useRef<HTMLDivElement>(null)
  const drum = useRatchetDrum(position, (delta) => nudgePosition(slot, delta))

  if (!config) return null

  const name = slotAriaName(slot, config.rotor)
  const current = toChar(position)
  const prevLetter = toChar(mod26(position - 1))
  const nextLetter = toChar(mod26(position + 1))
  const startLetter = toChar(config.start)
  const nudge = (delta: number) => nudgePosition(slot, delta)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault()
      nudge(1)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault()
      nudge(-1)
    } else if (event.key === 'PageUp') {
      event.preventDefault()
      nudge(5)
    } else if (event.key === 'PageDown') {
      event.preventDefault()
      nudge(-5)
    }
  }

  const chevron = 'size-11 rounded-none p-0 sm:size-[58px] [&_svg]:size-4 sm:[&_svg]:size-5'
  const neighbour = cn(cellSize, 'cursor-pointer bg-transparent')
  /** Letter spacing in px, for drag-to-turn. */
  const pitch = () => {
    const height = drumRef.current?.getBoundingClientRect().height ?? 0
    return height > 0 ? (height - 2) / 3 : 56
  }

  return (
    <Column
      caption={`${config.rotor} · ${ringLabel(config.ring, ringDisplay)}`}
      slotName={SLOT_NAMES[slot]}
    >
      <motion.div
        ref={wheelRef}
        className={cn('relative cursor-grab touch-pan-x active:cursor-grabbing', drumVars)}
        style={{ y: drum.kick }}
        onPanStart={drum.pan.onPanStart}
        onPan={(event, info) => drum.pan.onPan(event, info, pitch())}
        onPanEnd={(event, info) => drum.pan.onPanEnd(event, info, pitch())}
        onClickCapture={(event) => {
          if (drum.consumeDragClick()) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
      >
        <div
          ref={drumRef}
          className="absolute inset-x-0 top-(--drum-top) h-(--drum-height) overflow-hidden rounded-md text-lg font-medium text-fg select-none sm:text-2xl"
        >
          <DrumLetters
            rotation={drum.rotation}
            target={drum.target}
            className="absolute inset-0"
          />
        </div>
        <div className={cn('flex flex-col', joinedColumn)} data-slot={slot}>
          <Button
            variant="outline"
            className={chevron}
            tabIndex={-1}
            aria-label={`${name}: next letter`}
            onClick={() => nudge(1)}
          >
            <ChevronUpIcon aria-hidden="true" />
          </Button>
          <Cell asChild className={neighbour}>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`${name}: previous letter ${prevLetter}`}
              onClick={() => nudge(-1)}
            />
          </Cell>
          <Cell
            active
            role="spinbutton"
            tabIndex={0}
            aria-label={`${name} window`}
            aria-valuenow={position + 1}
            aria-valuemin={1}
            aria-valuemax={26}
            aria-valuetext={
              current === startLetter ? current : `${current}, start position ${startLetter}`
            }
            data-stepped={flashing ? '' : undefined}
            onKeyDown={onKeyDown}
            className={cn(cellSize, 'cursor-ns-resize bg-transparent', flashing && flashRing)}
          >
            <span className="sr-only">{current}</span>
          </Cell>
          <Cell asChild className={neighbour}>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`${name}: next letter ${nextLetter}`}
              onClick={() => nudge(1)}
            />
          </Cell>
          <Button
            variant="outline"
            className={chevron}
            tabIndex={-1}
            aria-label={`${name}: previous letter`}
            onClick={() => nudge(-1)}
          >
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        </div>
        <Thumbwheel rotation={drum.rotation} />
      </motion.div>
    </Column>
  )
}

function StartPositionNote() {
  const keyPresses = useEnigmaStore((s) => selectResult(s).traces.length)
  const starts = useEnigmaStore(
    useShallow((s) => {
      const { greek, left, middle, right } = s.settings
      return [greek?.position ?? null, left.position, middle.position, right.position]
    }),
  )
  const doubleStep = useEnigmaStore((s) => selectActiveTrace(s)?.stepping.doubleStep ?? false)

  if (keyPresses === 0) return null

  const startText = starts
    .filter((p): p is number => p !== null)
    .map(toChar)
    .join(' ')

  return (
    <p className="mt-4 mb-0 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-sm text-muted">
      <span>
        Start position: <span className="font-semibold text-fg">{startText}</span> — current position
        reflects {keyPresses} key {keyPresses === 1 ? 'press' : 'presses'}
      </span>
      {doubleStep && (
        <Hint content="The middle rotor sat on its notch, so it stepped together with the left rotor.">
          <Badge variant="outline" tabIndex={0} className="cursor-help">
            double step
          </Badge>
        </Hint>
      )}
    </p>
  )
}

export type RotorWindowsProps = Omit<ComponentProps<'section'>, 'children'>

/**
 * The rotor window strip (the Turing tape's analogue): reflector, [Greek], left,
 * middle and right rotor windows showing the CURRENT positions. Chevrons, the
 * neighbour letters, the mouse wheel and ↑/↓ on a focused window move the START
 * position (the text is re-enciphered).
 */
export function RotorWindows({ className, ...props }: RotorWindowsProps) {
  const reflector = useEnigmaStore((s) => s.settings.reflector)
  const hasGreek = useEnigmaStore((s) => s.settings.greek !== null)
  const flash = useStepFlash()

  const slots: SlotId[] = hasGreek
    ? ['greek', 'left', 'middle', 'right']
    : ['left', 'middle', 'right']

  return (
    <section aria-label="Rotor windows" className={cn('relative min-w-0', className)} {...props}>
      <div className="absolute top-1 right-0 z-[1] flex items-center">
        <InfoTip label="Rotor windows" align="end" contentClassName="w-96 max-w-[min(24rem,var(--radix-popover-content-available-width))]">
          <p>
            The windows show the letter each rotor is at right now. The right rotor steps on every
            key press, before the letter is enciphered.
          </p>
          <dl>
            <dt>Change the start position</dt>
            <dd>
              Click ▲ / ▼ or the letters above and below the window, scroll or drag the wheel, or
              focus a window and press ↑ / ↓.
            </dd>
            <dt>UKW</dt>
            <dd>The reflector; it does not turn. Change it under Reflector.</dd>
            <dt>Caption (e.g. I · 01)</dt>
            <dd>The rotor in that slot and its ring setting.</dd>
          </dl>
        </InfoTip>
      </div>
      <div className="overflow-x-auto">
        <div className="mx-auto flex w-max items-start gap-2 py-1 pr-4 sm:gap-4 sm:pr-5">
          <ReflectorWindow reflector={reflector} />
          {slots.map((slot) => (
            <RotorWindow
              key={slot}
              slot={slot}
              flashing={slot !== 'greek' && flash !== null && flash[slot]}
            />
          ))}
        </div>
      </div>
      <StartPositionNote />
    </section>
  )
}
