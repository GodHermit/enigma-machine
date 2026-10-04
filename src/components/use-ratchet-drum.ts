import { useEffect, useRef, useState } from 'react'
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react'
import type { AnimationPlaybackControls, Easing, MotionValue, PanInfo } from 'motion/react'
import { mod26 } from '../lib/enigma'

/*
 * Ratchet physics for the rotor windows.
 *
 * The drum's rotation is a continuous, unwrapped motion value measured in
 * letters (A = 0, one full turn = 26). Every change of the window position is
 * played as a ratchet stroke: the pawl lifts (tiny pull-back), the detent
 * spring releases (accelerating snap), the drum overshoots and an underdamped
 * spring seats it in the detent. Crossing a letter fires a "click" that jolts
 * the frame, and the pawl beside the thumbwheel rides the tooth profile.
 */

/** Released detent spring: accelerates into the next tooth. */
const SNAP: Easing = [0.55, 0, 1, 0.45]
/** Pawl lift before the stroke. */
const LIFT: Easing = [0.25, 1, 0.5, 1]
/** Long spins (e.g. Reset after many key presses). */
const SPIN: Easing = [0.3, 0, 0.2, 1]
/** Underdamped (ζ ≈ 0.43) so the drum visibly bounces into the detent. */
const DETENT = { type: 'spring', stiffness: 1100, damping: 24, mass: 0.7 } as const
const OVERSHOOT = 0.09

interface Stroke {
  stop: () => void
}

/** Plays one ratchet stroke from the current rotation to `target` (in letters). */
function ratchet(rotation: MotionValue<number>, target: number): Stroke {
  const from = rotation.get()
  const distance = target - from
  const dir = Math.sign(distance)
  const teeth = Math.abs(distance)
  let stopped = false
  let current: AnimationPlaybackControls | null = null

  const settle = () => {
    if (!stopped) current = animate(rotation, target, DETENT)
  }

  if (teeth < 0.5) {
    settle()
  } else {
    let keyframes: number[]
    let ease: Easing[]
    let duration: number
    const alreadyMoving = Math.abs(rotation.getVelocity()) > 1

    if (teeth <= 1.5) {
      // One tooth: lift the pawl (unless interrupting a stroke in flight), then snap.
      keyframes = alreadyMoving
        ? [from, target + OVERSHOOT * dir]
        : [from, from - 0.06 * dir, target + OVERSHOOT * dir]
      ease = alreadyMoving ? [SNAP] : [LIFT, SNAP]
      duration = alreadyMoving ? 0.09 : 0.14
    } else if (teeth <= 5) {
      // A few teeth: click through each one (accelerate into every tooth).
      const n = Math.round(teeth)
      const pitch = distance / n
      keyframes = [from]
      for (let k = 1; k <= n; k++) {
        keyframes.push(k === n ? target + OVERSHOOT * dir : from + pitch * k)
      }
      ease = Array.from({ length: n }, () => SNAP)
      duration = 0.02 + 0.07 * n
    } else {
      // Long way round: a fast spin that decelerates into the detent.
      keyframes = [from, target + 0.14 * dir]
      ease = [SPIN]
      duration = Math.min(0.55, 0.16 + 0.025 * teeth)
    }

    const times = keyframes.map((_, i) => i / (keyframes.length - 1))
    current = animate(rotation, keyframes, { duration, times, ease })
    current.finished.then(settle, () => {})
  }

  return {
    stop() {
      stopped = true
      current?.stop()
    },
  }
}

export interface RatchetDrum {
  /** Continuous drum rotation in letters (unwrapped). */
  rotation: MotionValue<number>
  /** Unwrapped integer the drum is heading to (≡ position mod 26). */
  target: number
  /** Frame jolt (px) fired on every detent click. */
  kick: MotionValue<number>
  /** Pan handlers for drag-to-turn; `pitch` is the letter spacing in px. */
  pan: {
    onPanStart: () => void
    onPan: (event: PointerEvent, info: PanInfo, pitch: number) => void
    onPanEnd: (event: PointerEvent, info: PanInfo, pitch: number) => void
  }
  /** True right after a drag, so the click that ends it can be swallowed. */
  consumeDragClick: () => boolean
}

/**
 * Drives one rotor drum. `position` is the window letter (0..25); `commit`
 * receives the number of letters the user turned the drum by dragging.
 */
export function useRatchetDrum(position: number, commit: (delta: number) => void): RatchetDrum {
  const reduceMotion = useReducedMotion()
  const rotation = useMotionValue(position)
  const kick = useMotionValue(0)

  // Unwrap 0..25 into a continuous target along the shortest path, so Z → A advances.
  const [track, setTrack] = useState({ position, target: position })
  if (track.position !== position) {
    let delta = mod26(position - track.position)
    if (delta > 13) delta -= 26
    setTrack({ position, target: track.target + delta })
  }
  const target = track.target

  const stroke = useRef<Stroke | null>(null)
  const dragging = useRef(false)
  const dragStart = useRef(0)
  /** Time the last drag ended; the click that ends a drag must not also nudge. */
  const dragEndedAt = useRef(-Infinity)

  useEffect(() => {
    if (dragging.current || rotation.get() === target) return
    stroke.current?.stop()
    if (reduceMotion) {
      rotation.jump(target)
      return
    }
    stroke.current = ratchet(rotation, target)
  }, [target, rotation, reduceMotion])

  useEffect(() => () => stroke.current?.stop(), [])

  // Detent clicks: one per letter crossed in the direction of travel (hysteresis
  // on the last clicked letter so the settling bounce does not click twice).
  const previous = useRef(position)
  const lastClicked = useRef(position)
  useMotionValueEvent(rotation, 'change', (value) => {
    const before = previous.current
    previous.current = value
    let dir: 0 | 1 | -1 = 0
    if (value > before) {
      const letter = Math.floor(value)
      if (letter > Math.floor(before) && letter !== lastClicked.current) {
        lastClicked.current = letter
        dir = 1
      }
    } else if (value < before) {
      const letter = Math.ceil(value)
      if (letter < Math.ceil(before) && letter !== lastClicked.current) {
        lastClicked.current = letter
        dir = -1
      }
    }
    if (dir === 0 || reduceMotion) return
    animate(kick, [-1.5 * dir, 0], { duration: 0.18, ease: 'easeOut' })
    if (dragging.current) navigator.vibrate?.(6)
  })

  const pan: RatchetDrum['pan'] = {
    onPanStart() {
      stroke.current?.stop()
      dragging.current = true
      dragStart.current = rotation.get()
    },
    onPan(_event, info, pitch) {
      // Dragging down pulls the previous letter into the window.
      rotation.set(dragStart.current - info.offset.y / pitch)
    },
    onPanEnd(_event, info, pitch) {
      dragging.current = false
      dragEndedAt.current = performance.now()
      const projected = rotation.get() - (info.velocity.y / pitch) * 0.12
      const snapped = Math.round(projected)
      const delta = snapped - target
      if (delta === 0) {
        stroke.current = ratchet(rotation, snapped)
        return
      }
      // Record the unwrapped target ourselves (a long drag may exceed 13 letters).
      setTrack({ position: mod26(position + delta), target: snapped })
      commit(delta)
    },
  }

  const consumeDragClick = () => performance.now() - dragEndedAt.current < 250

  return { rotation, target, kick, pan, consumeDragClick }
}
