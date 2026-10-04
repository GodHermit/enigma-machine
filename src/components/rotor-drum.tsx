import { useId, useRef, useState } from 'react'
import { motion, useMotionValueEvent, useTransform } from 'motion/react'
import type { MotionValue } from 'motion/react'
import { mod26, toChar } from '../lib/enigma'

/*
 * Visual parts of a rotor drum, driven by the rotation from useRatchetDrum:
 * the cylinder of letters behind the window cells and the knurled thumbwheel
 * with its pawl.
 */

/** Drum curvature between adjacent letters (exaggerated so 3 visible letters read as a cylinder). */
const LETTER_ANGLE = Math.PI / 5
const SIN_LETTER_ANGLE = Math.sin(LETTER_ANGLE)
const RAD_TO_DEG = 180 / Math.PI
/** Letters rendered either side of the target: any shortest-path jump (≤ 13) plus the visible ±2. */
const RENDER_RADIUS = 15
/**
 * Letters also rendered around where the drum currently points: a long drag or fast spin can
 * carry the rotation far from the target, and the window must never run out of letters.
 */
const CURRENT_RADIUS = 6

/*
 * Motion blur: a vertical-only Gaussian blur whose strength follows the drum's speed
 * (letters per second). A single click stays nearly crisp, long spins smear.
 */
const BLUR_PER_SPEED = 0.12
const MAX_BLUR = 3
/** Below this the filter is removed entirely so resting letters render sharp. */
const MIN_BLUR = 0.35

function DrumLetter({ index, rotation }: { index: number; rotation: MotionValue<number> }) {
  const transform = useTransform(rotation, (r) => {
    const d = Math.max(-2.6, Math.min(2.6, index - r))
    const y = Math.sin(d * LETTER_ANGLE) / SIN_LETTER_ANGLE
    return `translateY(calc(var(--pitch) * ${y.toFixed(4)})) rotateX(${(-d * LETTER_ANGLE * RAD_TO_DEG).toFixed(2)}deg)`
  })
  const opacity = useTransform(rotation, (r) => {
    const a = Math.abs(index - r)
    if (a >= 2) return 0
    return a <= 1 ? 1 - 0.45 * a : 0.55 * (2 - a)
  })
  return (
    <motion.span
      className="absolute inset-x-0 top-1/2 -mt-[calc(var(--pitch)/2)] flex h-(--pitch) items-center justify-center backface-hidden"
      style={{ transform, opacity }}
    >
      {toChar(mod26(index))}
    </motion.span>
  )
}

/**
 * The letter ring seen through the window: a cylinder of letters behind the
 * (transparent) prev / current / next cells. Absolutely positioned over them.
 */
export function DrumLetters({
  rotation,
  target,
  className,
}: {
  rotation: MotionValue<number>
  target: number
  className?: string
}) {
  // Re-render only when the drum moves out of the letters already around its current position.
  const [current, setCurrent] = useState(() => Math.round(rotation.get()))
  useMotionValueEvent(rotation, 'change', (r) => {
    const nearest = Math.round(r)
    if (Math.abs(nearest - current) > CURRENT_RADIUS - 3) setCurrent(nearest)
  })
  const from = Math.min(target - RENDER_RADIUS, current - CURRENT_RADIUS)
  const to = Math.max(target + RENDER_RADIUS, current + CURRENT_RADIUS)
  const letters: number[] = []
  for (let i = from; i <= to; i++) letters.push(i)

  // useId() may contain characters that break `url(#…)` references.
  const filterId = `drum-blur${useId().replace(/[^\w-]/g, '')}`
  const boxRef = useRef<HTMLDivElement>(null)
  const blurRef = useRef<SVGFEGaussianBlurElement>(null)

  // Written straight to the DOM every frame (no React renders while the drum spins).
  const setBlur = (sigma: number) => {
    const on = sigma >= MIN_BLUR
    blurRef.current?.setAttribute('stdDeviation', on ? `0 ${sigma.toFixed(2)}` : '0')
    if (boxRef.current) boxRef.current.style.filter = on ? `url(#${filterId})` : ''
  }
  useMotionValueEvent(rotation, 'change', () => {
    setBlur(Math.min(MAX_BLUR, Math.abs(rotation.getVelocity()) * BLUR_PER_SPEED))
  })
  // The last frame of a stroke can still report speed; once it ends, the drum is at rest.
  useMotionValueEvent(rotation, 'animationComplete', () => setBlur(0))
  useMotionValueEvent(rotation, 'animationCancel', () => setBlur(0))

  return (
    <div
      ref={boxRef}
      aria-hidden="true"
      className={className}
      style={{
        perspective: '320px',
        maskImage: 'linear-gradient(to bottom, transparent, #000 24%, #000 76%, transparent)',
      }}
    >
      <svg className="absolute size-0" focusable="false">
        <filter id={filterId} x="0" y="-25%" width="100%" height="150%" colorInterpolationFilters="sRGB">
          <feGaussianBlur ref={blurRef} stdDeviation="0" />
        </filter>
      </svg>
      {letters.map((index) => (
        <DrumLetter key={index} index={index} rotation={rotation} />
      ))}
    </div>
  )
}

/**
 * Knurled thumbwheel that turns with the drum, plus the pawl riding its teeth:
 * a teardrop lever on a pivot pin whose tip rises along each tooth and drops
 * as the next letter seats. It is grabbable: drag and scroll events bubble to the
 * drum's pan / wheel handlers (it renders inside that element), through a hit area
 * wider than the thin wheel itself.
 */
export function Thumbwheel({ rotation }: { rotation: MotionValue<number> }) {
  const knurl = useTransform(rotation, (r) => `calc(var(--pitch) * ${(-r).toFixed(4)})`)
  const pawl = useTransform(rotation, (r) => {
    const f = r - Math.floor(r)
    const lift = f < 0.82 ? f / 0.82 : (1 - f) / 0.18
    return `rotate(${(lift * 14).toFixed(2)}deg)`
  })
  return (
    <>
      {/* 20px hit area centred on the wheel (right + 6px, sm: right + 8.5px). */}
      <div
        aria-hidden="true"
        data-thumbwheel=""
        className="group/thumb absolute top-(--drum-top) -right-4 flex h-(--drum-height) w-5 touch-none justify-center sm:-right-[18.5px]"
      >
        <div className="relative h-full w-2 overflow-hidden rounded-full border border-border bg-surface transition-colors group-hover/thumb:border-border-strong group-active/thumb:border-fg sm:w-[9px]">
          <motion.div
            className="absolute inset-0 bg-[repeating-linear-gradient(to_bottom,var(--border-strong)_0_2px,transparent_2px_calc(var(--pitch)/4))]"
            style={{ backgroundPositionY: knurl }}
          />
          <div className="absolute inset-0 bg-linear-to-b from-bg via-transparent to-bg" />
        </div>
      </div>
      {/* Pivot sits at (11.5, 6) of the 16×12 box; the tip overlaps the thumbwheel by 1px. */}
      <motion.svg
        aria-hidden="true"
        viewBox="0 0 16 12"
        className="pointer-events-none absolute top-[calc(var(--drum-top)+var(--drum-height)/2-4px)] -right-[19px] h-2 w-2.5 overflow-visible text-fg sm:top-[calc(var(--drum-top)+var(--drum-height)/2-6px)] sm:-right-[28px] sm:h-3 sm:w-4"
        style={{ transform: pawl, transformOrigin: '71.875% 50%' }}
      >
        <path
          d="M1.25 6 L10.47 2.92 A3.25 3.25 0 1 1 10.47 9.08 Z"
          className="fill-bg stroke-current"
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx="11.5" cy="6" r="1.25" className="fill-current" />
      </motion.svg>
    </>
  )
}
