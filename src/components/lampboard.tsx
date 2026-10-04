import { memo, useId } from 'react'
import type { CSSProperties, ComponentProps, ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Transition } from 'motion/react'
import { KEYBOARD_ROWS, toChar } from '../lib/enigma'
import { cn } from '../lib/cn'
import { selectActiveTrace, useEnigmaStore } from '../state'
import type { EnigmaState } from '../state'
import { InfoTip, Kbd, cellVariants } from './ui'

/*
 * Lampboard layout: QWERTZ rows (9/8/9) centred on top of each other, so the shorter
 * middle row sits half a key indented like on a real Enigma.
 * 34px round cells with 2px gaps on phones (9 × 34 + 8 × 2 = 322px fits a 360px screen
 * with the 16px page gutters), 44px with 8px gaps from `sm` up.
 */

/** Vertical stack of the three rows. */
export const boardRowsClass = 'flex flex-col items-center gap-1.5 sm:gap-2'

/** One row of round cells. */
export const boardRowClass = 'flex justify-center gap-0.5 sm:gap-2'

/** Size override for round board cells (on top of `cellVariants({ size: 'sm', round: true })`). */
export const boardCellSize = 'max-sm:size-[34px] max-sm:text-base font-medium'

export interface BoardLabelProps extends ComponentProps<'h2'> {
  /** Explanation shown in a "?" popover after the heading (kept out of the heading's name). */
  info?: ReactNode
}

/** "Lampboard:" / "Keyboard:" caption in the `.form-label` style. */
export function BoardLabel({ className, info, ...props }: BoardLabelProps) {
  const heading = (
    <h2
      className={cn('mb-2 text-base leading-6 font-normal text-fg', info != null && 'mb-0', className)}
      {...props}
    />
  )
  if (info == null) return heading
  const name =
    typeof props.children === 'string' ? props.children.replace(/:\s*$/, '') : 'this section'
  return (
    <div className="mb-2 flex items-center gap-1">
      {heading}
      <InfoTip label={name}>{info}</InfoTip>
    </div>
  )
}

/**
 * The letter of the lamp that is lit: the output of the visualised key press, but only
 * once the playback has carried the signal all the way to the lampboard.
 */
function selectLitLamp(s: EnigmaState): string | null {
  const trace = selectActiveTrace(s)
  if (!trace) return null
  if (s.stageCursor !== null && s.stageCursor < trace.stages.length) return null
  return toChar(trace.output)
}

/** Switching off: the filament cools — dimmer, redder, slowly fading. */
const COOL: Transition = { duration: 0.6, ease: [0.3, 0, 0.2, 1] }

/**
 * The light of a lit lamp: bloom, halo and bulb layers (look in index.css `.lamp-*`).
 * Mounting = switch-on (white flash, flicker, springy pop), unmounting = cooling fade;
 * while lit the halo breathes.
 */
function LampGlow() {
  const reduce = useReducedMotion()
  if (reduce) {
    return (
      <>
        <motion.span aria-hidden className="lamp-layer lamp-pool" exit={{ opacity: 0 }} />
        <motion.span aria-hidden className="lamp-layer lamp-bloom" exit={{ opacity: 0 }} />
        <motion.span aria-hidden className="lamp-layer lamp-halo" exit={{ opacity: 0 }} />
        <motion.span aria-hidden className="lamp-layer lamp-bulb" exit={{ opacity: 0 }} />
      </>
    )
  }
  return (
    <>
      {/* Light thrown at an angle onto the panel: grows out after the bulb catches. */}
      <motion.span
        aria-hidden
        className="lamp-layer lamp-pool"
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: [0, 1, 0.8, 1], scale: 1 }}
        exit={{ opacity: 0, scale: 0.85, transition: COOL }}
        transition={{
          opacity: { duration: 0.8, times: [0, 0.3, 0.6, 1], ease: 'easeOut', delay: 0.04 },
          scale: { type: 'spring', stiffness: 140, damping: 16 },
        }}
      />
      <motion.span
        aria-hidden
        className="lamp-layer lamp-bloom"
        initial={{ opacity: 0, scale: 0.3 }}
        animate={{ opacity: [0, 1, 0.75, 1], scale: [0.3, 1.15, 1] }}
        exit={{ opacity: 0, scale: 0.8, transition: COOL }}
        transition={{
          opacity: { duration: 0.9, times: [0, 0.25, 0.6, 1], ease: 'easeOut' },
          scale: { type: 'spring', stiffness: 160, damping: 14 },
        }}
      />
      <motion.span
        aria-hidden
        className="lamp-layer lamp-halo"
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.7, filter: 'saturate(1.6) hue-rotate(-14deg)', transition: COOL }}
        transition={{
          opacity: { duration: 0.12 },
          scale: { type: 'spring', stiffness: 380, damping: 12 },
        }}
      >
        {/* Breathing: a slow shimmer while the lamp stays lit. */}
        <motion.span
          className="lamp-layer lamp-halo inset-0"
          animate={{ opacity: [0, 0.6], scale: [1, 1.12] }}
          transition={{
            duration: 2.4,
            delay: 0.6,
            repeat: Infinity,
            repeatType: 'mirror',
            ease: 'easeInOut',
          }}
        />
      </motion.span>
      <motion.span
        aria-hidden
        className="lamp-layer lamp-bulb"
        initial={{ opacity: 0, scale: 0.8, filter: 'brightness(2.4) saturate(0.2)' }}
        animate={{
          // Incandescent catch: on, a quick dip, then steady.
          opacity: [0, 1, 0.55, 1],
          scale: 1,
          filter: 'brightness(1) saturate(1)',
        }}
        exit={{
          opacity: 0,
          scale: 0.94,
          filter: 'brightness(0.85) saturate(1.8) hue-rotate(-16deg)',
          transition: COOL,
        }}
        transition={{
          opacity: { duration: 0.32, times: [0, 0.18, 0.4, 1], ease: 'easeOut' },
          scale: { type: 'spring', stiffness: 600, damping: 13 },
          filter: { duration: 0.7, ease: 'easeOut' },
        }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Light on the neighbours                                             */
/* ------------------------------------------------------------------ */

/** Lamp centres in key pitches (the middle row is indented half a key). */
const LAMP_POSITIONS = new Map(
  KEYBOARD_ROWS.flatMap((row, r) =>
    Array.from(row, (letter, c) => [letter, { x: c + (r === 1 ? 0.5 : 0), y: r }] as const),
  ),
)

/** How far (in key pitches) a lit lamp lights up the caps around it. */
const LIGHT_REACH = 2.6

/**
 * The light leaves the lamp at an angle (down and to the right, like the `.lamp-pool` in
 * index.css), so caps in that direction catch more of it and caps behind it less.
 */
const LIGHT_ANGLE = (32 * Math.PI) / 180
const BEAM = { x: Math.cos(LIGHT_ANGLE), y: Math.sin(LIGHT_ANGLE) }

/** Light falling on one lamp cap: intensity 0..1 and the unit vector pointing to the light. */
interface CapLight {
  light: number
  lx: number
  ly: number
}

const DARK: CapLight = { light: 0, lx: 0, ly: 0 }

function capLight(lit: string | null, letter: string): CapLight {
  if (lit === null || lit === letter) return DARK
  const cap = LAMP_POSITIONS.get(letter)
  const source = LAMP_POSITIONS.get(lit)
  if (!cap || !source) return DARK
  const dx = source.x - cap.x
  const dy = source.y - cap.y
  const distance = Math.hypot(dx, dy)
  if (distance >= LIGHT_REACH) return DARK
  // How much this cap lies along the beam: +1 straight down-right, -1 straight up-left.
  const along = (-dx * BEAM.x - dy * BEAM.y) / distance
  const falloff = (1 - distance / LIGHT_REACH) ** 1.5
  const light = Math.min(1, falloff * (0.8 + 0.45 * along))
  const r = (n: number) => Math.round(n * 1000) / 1000
  return { light: r(light), lx: r(dx / distance), ly: r(dy / distance) }
}

interface LampProps extends CapLight {
  letter: string
  lit: boolean
  /** Key press that lit the lamp: a new one re-ignites it even when the letter repeats. */
  pressId?: number
}

/**
 * One lamp. Unlit caps near the lit one pick up its light (CSS in index.css `.lamp`):
 * a warm rim on the side facing it, a tinted face and a shadow cast away from it.
 */
const Lamp = memo(function Lamp({ letter, lit, pressId, light, lx, ly }: LampProps) {
  return (
    <div
      data-letter={letter}
      data-lit={lit ? '' : undefined}
      style={{ '--lamp-light': light, '--lamp-lx': lx, '--lamp-ly': ly } as CSSProperties}
      className={cellVariants({
        size: 'sm',
        round: true,
        className: cn(
          'lamp',
          boardCellSize,
          // Lit: above the neighbours so the halo spills over them; warm dark letter on the bulb.
          lit && 'z-10 border-transparent text-lamp-letter hover:z-10 hover:border-transparent',
        ),
      })}
    >
      <AnimatePresence>{lit && <LampGlow key={pressId} />}</AnimatePresence>
      {letter}
    </div>
  )
})

export interface LampboardProps extends Omit<ComponentProps<'section'>, 'children'> {
  /** Caption above the lamps (default "Lampboard:"). */
  label?: string
}

/**
 * Lampboard: 26 round lamps in the QWERTZ layout. The lamp of the visualised key press
 * lights up (yellow glow) when the signal reaches it; a polite live region announces it.
 */
export function Lampboard({ className, label = 'Lampboard:', ...props }: LampboardProps) {
  const labelId = useId()
  const lit = useEnigmaStore(selectLitLamp)
  const pressId = useEnigmaStore((s) => s.pressId)

  return (
    <section aria-labelledby={labelId} className={cn('min-w-0', className)} {...props}>
      <BoardLabel
        id={labelId}
        info={
          <>
            <p>The lamps show the machine's output: the enciphered letter of a key press lights up.</p>
            <p>
              A key never lights its own lamp. That flaw of the reflector helped the codebreakers
              at Bletchley Park.
            </p>
          </>
        }
      >
        {label}
      </BoardLabel>
      <div className={boardRowsClass} aria-hidden="true">
        {KEYBOARD_ROWS.map((row) => (
          <div key={row} className={boardRowClass}>
            {Array.from(row).map((letter) => (
              <Lamp
                key={letter}
                letter={letter}
                lit={letter === lit}
                pressId={letter === lit ? pressId : undefined}
                {...capLight(lit, letter)}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-sm text-muted pointer-coarse:hidden">
        Type on your keyboard to press keys · <Kbd>Backspace</Kbd> undoes the last key
      </p>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {lit ? `Lamp ${lit} lit` : ''}
      </p>
    </section>
  )
}
