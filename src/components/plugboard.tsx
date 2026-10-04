import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ComponentProps } from 'react'
import { XIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../lib/cn'
import {
  HISTORICAL_PLUGS,
  KEYBOARD_ROWS,
  MAX_PLUGS,
  formatPlugboard,
  parsePlugboard,
  toChar,
  toLetter,
} from '../lib/enigma'
import type { KeypressTrace, Letter, PlugPair } from '../lib/enigma'
import { selectActiveTrace, useEnigmaStore } from '../state'
import type { EnigmaState } from '../state'
import { Button, Field, Input, InputGroup, InputGroupText, cellVariants } from './ui'

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------------------------------------------*/

const SEPARATOR = /[\s,;/-]/

/** Letters of KEYBOARD_ROWS as Letter values (QWERTZ, 9 / 8 / 9). */
const SOCKET_ROWS: Letter[][] = KEYBOARD_ROWS.map((row) =>
  Array.from(row, (ch) => toLetter(ch) ?? 0),
)

/**
 * Parse errors to show while the user is still typing: an unfinished trailing
 * token (odd number of letters, no separator after it yet) is not reported.
 */
function liveErrors(text: string): string[] {
  if (text.length === 0 || SEPARATOR.test(text.at(-1) ?? '')) return parsePlugboard(text).errors
  const tokens = text.split(SEPARATOR)
  const last = tokens.at(-1) ?? ''
  if (/^[a-z]+$/i.test(last) && last.length % 2 === 1) {
    return parsePlugboard(text.slice(0, text.length - last.length)).errors
  }
  return parsePlugboard(text).errors
}

/** Partner of every letter (null when unplugged). */
function partnerTable(pairs: readonly PlugPair[]): (Letter | null)[] {
  const table: (Letter | null)[] = Array.from({ length: 26 }, () => null)
  for (const [a, b] of pairs) {
    table[a] = b
    table[b] = a
  }
  return table
}

/** Plugboard contacts of the visualised key press (-1 when not revealed / no trace). */
interface PlugSignal {
  forwardIn: number
  forwardOut: number
  returnIn: number
  returnOut: number
}

const NO_SIGNAL: PlugSignal = { forwardIn: -1, forwardOut: -1, returnIn: -1, returnOut: -1 }

function plugSignal(trace: KeypressTrace | null, cursor: number | null): PlugSignal {
  if (trace === null) return NO_SIGNAL
  const revealed = (index: number) => index >= 0 && (cursor === null || index < cursor)
  const fwdIndex = trace.stages.findIndex((s) => s.kind === 'plugboard' && s.direction === 'forward')
  const bwdIndex = trace.stages.findIndex((s) => s.kind === 'plugboard' && s.direction === 'backward')
  const fwd = revealed(fwdIndex) ? trace.stages[fwdIndex] : null
  const bwd = revealed(bwdIndex) ? trace.stages[bwdIndex] : null
  return {
    forwardIn: fwd?.input ?? -1,
    forwardOut: fwd?.output ?? -1,
    returnIn: bwd?.input ?? -1,
    returnOut: bwd?.output ?? -1,
  }
}

const selectPlugSignal = (s: EnigmaState): PlugSignal => plugSignal(selectActiveTrace(s), s.stageCursor)

/** in = forward (keyboard → reflector), out = return (reflector → lamp). */
type SignalRole = 'in' | 'out' | 'both'

interface SocketPoint {
  x: number
  y: number
  size: number
}

interface BoardLayout {
  width: number
  height: number
  points: (SocketPoint | null)[]
}

const EMPTY_LAYOUT: BoardLayout = { width: 0, height: 0, points: [] }

function sameLayout(a: BoardLayout, b: BoardLayout): boolean {
  if (a.width !== b.width || a.height !== b.height || a.points.length !== b.points.length) return false
  return a.points.every((p, i) => {
    const q = b.points[i]
    return p === q || (p !== null && q !== null && p.x === q.x && p.y === q.y && p.size === q.size)
  })
}

/** Hanging cable between two sockets: a cubic curve that sags below both plugs. */
function cableGeometry(a: SocketPoint, b: SocketPoint, height: number) {
  const [p, q] = a.x <= b.x ? [a, b] : [b, a]
  const x1 = p.x
  const x2 = q.x
  const y1 = p.y + p.size * 0.24
  const y2 = q.y + q.size * 0.24
  const lowest = Math.max(y1, y2)
  // The curve's lowest point is at most `lowest + 0.75 * sag`; keep it inside the board.
  const room = height > 0 ? Math.max(4, (height - 3 - lowest) / 0.75) : 40
  const sag = Math.min(14 + Math.abs(x2 - x1) * 0.22 + Math.abs(y2 - y1) * 0.15, 44, room)
  const r = (n: number) => Math.round(n * 10) / 10
  return {
    d: `M ${r(x1)} ${r(y1)} C ${r(x1)} ${r(y1 + sag)}, ${r(x2)} ${r(y2 + sag)}, ${r(x2)} ${r(y2)}`,
    ends: [
      [r(x1), r(y1)],
      [r(x2), r(y2)],
    ] as const,
  }
}

/* ------------------------------------------------------------------------------------------------
 * Text control
 * ----------------------------------------------------------------------------------------------*/

interface Draft {
  text: string
  /** formatPlugboard() of the pairs this draft produced; stale once the store differs. */
  key: string
  errors: string[]
  editing: boolean
}

function PlugboardText({ pairs }: { pairs: PlugPair[] }) {
  const inputId = useId()
  const setPlugboard = useEnigmaStore((s) => s.setPlugboard)
  const clearPlugboard = useEnigmaStore((s) => s.clearPlugboard)
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const formatted = formatPlugboard(pairs)
  // A draft only applies while the store still holds the pairs it produced, so changes
  // from elsewhere (randomize, import, socket clicks) replace the text immediately.
  const current = draft !== null && draft.key === formatted ? draft : null
  const value = current?.editing ? current.text : formatted
  const errors = current?.errors ?? []

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const text = event.target.value
    const next = parsePlugboard(text).pairs
    const key = formatPlugboard(next)
    setDraft({ text, key, errors: liveErrors(text), editing: true })
    if (key !== formatted) setPlugboard(next)
  }

  function handleBlur() {
    setDraft((d) =>
      d === null ? null : { ...d, editing: false, errors: parsePlugboard(d.text).errors },
    )
  }

  function handleClear() {
    clearPlugboard()
    setDraft(null)
    inputRef.current?.focus()
  }

  return (
    <Field
      label="Plugboard:"
      htmlFor={inputId}
      info={
        <>
          <p>
            Steckerbrett: cables swap pairs of letters before and after the rotors. Type pairs like{' '}
            <span className="font-mono">AB CD EF</span> or click two sockets below.
          </p>
          <p>
            On the board, click a free socket and then another to connect them; click a connected
            socket to unplug its cable. During signal playback the cables in use are highlighted.
          </p>
          <p>
            Each letter can be in only one pair; up to {MAX_PLUGS} cables fit. Historically{' '}
            {HISTORICAL_PLUGS} were used. The × button removes all cables.
          </p>
        </>
      }
      error={
        errors.length > 0
          ? errors.map((message, i) => (
              <span key={i} className="block">
                {message}
              </span>
            ))
          : undefined
      }
    >
      <InputGroup>
        <Input
          ref={inputRef}
          id={inputId}
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder="e.g. AB CD EF"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={errors.length > 0 || undefined}
          className="tracking-wide uppercase placeholder:tracking-normal placeholder:normal-case"
        />
        <InputGroupText title={`${pairs.length} of ${MAX_PLUGS} cables plugged`}>
          <span aria-hidden="true">
            {pairs.length}/{MAX_PLUGS}
          </span>
          <span className="sr-only">
            {pairs.length} of {MAX_PLUGS} cables
          </span>
        </InputGroupText>
        <Button
          size="icon"
          aria-label="Clear plugboard"
          title="Clear plugboard"
          disabled={pairs.length === 0}
          onClick={handleClear}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </InputGroup>
    </Field>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Visual Steckerbrett
 * ----------------------------------------------------------------------------------------------*/

interface Notice {
  key: string
  message: string
}

function Steckerbrett({ pairs }: { pairs: PlugPair[] }) {
  const togglePlug = useEnigmaStore((s) => s.togglePlug)
  const signal = useEnigmaStore(useShallow(selectPlugSignal))
  const [pending, setPending] = useState<Letter | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [layout, setLayout] = useState<BoardLayout>(EMPTY_LAYOUT)
  const boardRef = useRef<HTMLDivElement>(null)
  const socketRefs = useRef<(HTMLButtonElement | null)[]>([])

  const partners = useMemo(() => partnerTable(pairs), [pairs])
  const formatted = formatPlugboard(pairs)
  const full = pairs.length >= MAX_PLUGS
  // A pending socket that got plugged elsewhere (or a full board) cancels the selection.
  const active = pending !== null && partners[pending] === null && !full ? pending : null
  const status = notice !== null && notice.key === formatted ? notice.message : null

  const measure = useCallback(() => {
    const board = boardRef.current
    if (board === null) return
    const box = board.getBoundingClientRect()
    const points = Array.from({ length: 26 }, (_, l): SocketPoint | null => {
      const el = socketRefs.current[l]
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        x: r.left - box.left + r.width / 2,
        y: r.top - box.top + r.height / 2,
        size: r.height,
      }
    })
    const next: BoardLayout = { width: box.width, height: box.height, points }
    setLayout((prev) => (sameLayout(prev, next) ? prev : next))
  }, [])

  useLayoutEffect(() => {
    measure()
    const board = boardRef.current
    if (board === null) return
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(() => measure())
    observer.observe(board)
    return () => observer.disconnect()
  }, [measure])

  useEffect(() => {
    if (active === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setPending(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active])

  function handleSocket(l: Letter) {
    if (active === null) {
      const partner = partners[l]
      if (partner !== null) {
        togglePlug(l, partner)
        announce(`Unplugged ${toChar(l)}–${toChar(partner)}.`)
        return
      }
      setPending(l)
      return
    }
    setPending(null)
    if (l === active) return
    togglePlug(active, l)
    announce(`Connected ${toChar(active)} and ${toChar(l)}.`)
  }

  /** Status message tied to the resulting plugboard, so it disappears after outside changes. */
  function announce(message: string) {
    setNotice({ key: formatPlugboard(useEnigmaStore.getState().settings.plugboard), message })
  }

  const cables = useMemo(() => {
    const role = (a: Letter, b: Letter): SignalRole | null => {
      const hit = (x: number, y: number) => x !== y && ((a === x && b === y) || (a === y && b === x))
      const fwd = hit(signal.forwardIn, signal.forwardOut)
      const ret = hit(signal.returnIn, signal.returnOut)
      return fwd && ret ? 'both' : fwd ? 'in' : ret ? 'out' : null
    }
    const list = pairs.map(([a, b]) => ({ a, b, role: role(a, b) }))
    // Highlighted cables are drawn last so they sit on top.
    return [...list.filter((c) => c.role === null), ...list.filter((c) => c.role !== null)]
  }, [pairs, signal])

  const hint =
    active !== null
      ? `${toChar(active)} selected — click another letter to connect it, or press Esc to cancel.`
      : full
        ? `All ${MAX_PLUGS} cables are in use. Click a connected letter to unplug it.`
        : status

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <div
          ref={boardRef}
          role="group"
          aria-label="Plugboard sockets"
          className="relative mx-auto flex w-max flex-col gap-1.5 px-2 pt-3 pb-6 sm:gap-2 sm:px-4 sm:pt-4 sm:pb-8"
        >
          {SOCKET_ROWS.map((row, rowIndex) => (
            <div key={rowIndex} className="flex justify-center gap-0.5 sm:gap-2">
              {row.map((l) => {
                const partner = partners[l]
                const isPending = active === l
                const isForward = signal.forwardIn === l || signal.forwardOut === l
                const isReturn = signal.returnIn === l || signal.returnOut === l
                const role: SignalRole | null =
                  isForward && isReturn ? 'both' : isForward ? 'in' : isReturn ? 'out' : null
                const letter = toChar(l)
                const label =
                  partner !== null
                    ? `Socket ${letter}, connected to ${toChar(partner)}`
                    : isPending
                      ? `Socket ${letter}, selected`
                      : `Socket ${letter}, not connected`
                return (
                  <button
                    key={l}
                    ref={(el) => {
                      socketRefs.current[l] = el
                    }}
                    type="button"
                    aria-label={label}
                    aria-pressed={partner !== null || isPending}
                    disabled={partner === null && full}
                    data-letter={letter}
                    data-partner={partner !== null ? toChar(partner) : undefined}
                    data-pending={isPending ? '' : undefined}
                    data-signal={role ?? undefined}
                    onClick={() => handleSocket(l)}
                    className={cellVariants({
                      size: 'sm',
                      active: isPending,
                      highlighted: partner !== null,
                      className: cn(
                        'size-8 cursor-pointer text-sm font-semibold sm:size-10 sm:text-base',
                        'disabled:cursor-not-allowed disabled:opacity-[.65] disabled:hover:border-border',
                        isPending && 'animate-pulse motion-reduce:animate-none',
                        role === 'in' &&
                          'border-signal-in text-signal-in ring-1 ring-signal-in hover:border-signal-in',
                        role === 'out' &&
                          'border-signal-out text-signal-out ring-1 ring-signal-out hover:border-signal-out',
                        // Same socket on the way in and out: orange border inside a blue ring.
                        role === 'both' &&
                          'border-signal-in text-signal-in ring-2 ring-signal-out hover:border-signal-in',
                      ),
                    })}
                  >
                    <span aria-hidden="true">{letter}</span>
                    {partner !== null && (
                      <span
                        aria-hidden="true"
                        className="absolute top-0 right-0.5 text-[9px] leading-3 font-bold text-muted sm:right-1 sm:text-[10px]"
                      >
                        {toChar(partner)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-20 overflow-visible"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${Math.max(layout.width, 1)} ${Math.max(layout.height, 1)}`}
          >
            {cables.map(({ a, b, role }) => {
              const pa = layout.points[a]
              const pb = layout.points[b]
              if (!pa || !pb) return null
              const { d, ends } = cableGeometry(pa, pb, layout.height)
              const stroke =
                role === null
                  ? 'var(--border-strong)'
                  : role === 'out'
                    ? 'var(--signal-out)'
                    : 'var(--signal-in)'
              return (
                <g
                  key={`${a}-${b}`}
                  data-cable={`${toChar(Math.min(a, b))}${toChar(Math.max(a, b))}`}
                  data-signal={role ?? undefined}
                >
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={role === null ? 2 : 3}
                    strokeOpacity={role === null ? 0.8 : 1}
                    strokeLinecap="round"
                  />
                  {role === 'both' && (
                    // Cable used in both directions: blue dashes over the orange stroke.
                    <path
                      d={d}
                      fill="none"
                      stroke="var(--signal-out)"
                      strokeWidth={3}
                      strokeDasharray="6 6"
                      strokeLinecap="round"
                    />
                  )}
                  {ends.map(([x, y], i) => (
                    <circle key={i} cx={x} cy={y} r={role === null ? 2.5 : 3} fill={stroke} />
                  ))}
                </g>
              )
            })}
          </svg>
        </div>
      </div>
      <p className="text-sm text-muted">
        Click two letters to connect them with a cable. Historically {HISTORICAL_PLUGS} cables were used.
      </p>
      <p aria-live="polite" className={cn('text-sm text-fg', hint === null && 'sr-only')}>
        {hint}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Plugboard
 * ----------------------------------------------------------------------------------------------*/

export type PlugboardProps = Omit<ComponentProps<'section'>, 'children'>

/**
 * "Plugboard:" block — text input (live-parsed, with cable count and clear button)
 * plus the interactive Steckerbrett with cables drawn between connected sockets.
 */
export function Plugboard({ className, ...props }: PlugboardProps) {
  const pairs = useEnigmaStore((s) => s.settings.plugboard)
  return (
    <section aria-label="Plugboard" className={cn('flex min-w-0 flex-col gap-3', className)} {...props}>
      <PlugboardText pairs={pairs} />
      <Steckerbrett pairs={pairs} />
    </section>
  )
}
