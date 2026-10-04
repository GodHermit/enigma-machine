import { memo, useId, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { toChar } from '../../lib/enigma'
import type { KeypressTrace, MachineSettings } from '../../lib/enigma'
import { cn } from '../../lib/cn'
import { useActiveTrace, useEnigmaStore } from '../../state'
import { focusRing } from '../ui'
import {
  GUTTER,
  KEY_DOT_RADIUS,
  RING_STRIP,
  ROW_COUNT,
  buildActivePath,
  buildStaticDiagram,
  rowY,
  shortStageLabel,
} from './geometry'
import type { ActivePath, Column, SignalTone, StaticDiagram, StepBadge } from './geometry'

const TONE_COLOR: Record<SignalTone, string> = {
  in: 'var(--signal-in)',
  out: 'var(--signal-out)',
}

/** Keyframes for the path drawing / signal head; disabled for reduced motion. */
const DIAGRAM_CSS = `
.sp-draw{stroke-dasharray:1;animation:sp-draw var(--sp-dur) linear var(--sp-delay) both}
@keyframes sp-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
.sp-fade{animation:sp-fade 180ms ease-out var(--sp-delay,0ms) both}
@keyframes sp-fade{from{opacity:0}to{opacity:1}}
.sp-pulse{transform-box:fill-box;transform-origin:center;animation:sp-pulse 1.2s ease-in-out infinite}
@keyframes sp-pulse{0%,100%{transform:scale(.75);opacity:.5}50%{transform:scale(1.3);opacity:.12}}
@media (prefers-reduced-motion:reduce){.sp-draw,.sp-fade,.sp-pulse{animation:none}.sp-draw{stroke-dasharray:none}}
`

const FONT = 'var(--font-sans)'

function timing(durationMs: number, delayMs: number): CSSProperties {
  return {
    ['--sp-dur' as string]: `${Math.round(durationMs)}ms`,
    ['--sp-delay' as string]: `${Math.round(delayMs)}ms`,
  } as CSSProperties
}

/* ------------------------------------------------------------------------ */
/* Static layers                                                             */
/* ------------------------------------------------------------------------ */

function badgeWidth(text: string): number {
  return Math.round(text.length * 5.6 + 10)
}

function HeaderBadge({ x, badge }: { x: number; badge: StepBadge }) {
  const w = badgeWidth(badge.text)
  const solid = badge.emphasis === 'solid'
  return (
    <g data-badge={badge.text}>
      <rect
        x={x - w / 2}
        y={64}
        width={w}
        height={16}
        rx={4}
        fill={solid ? 'var(--fg)' : badge.emphasis === 'muted' ? 'var(--surface-2)' : 'var(--bg)'}
        stroke={badge.emphasis === 'muted' ? 'none' : 'var(--fg)'}
      />
      <text
        x={x}
        y={75.5}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        fill={solid ? 'var(--bg)' : badge.emphasis === 'muted' ? 'var(--muted)' : 'var(--fg)'}
      >
        {badge.text}
      </text>
    </g>
  )
}

function ColumnHeader({
  column,
  caption,
  name,
  detail,
  badge,
}: {
  column: Column
  caption: string
  name: string
  detail: string
  badge?: StepBadge | null
}) {
  return (
    <g>
      <text
        x={column.cx}
        y={16}
        textAnchor="middle"
        fontSize={9.5}
        letterSpacing="0.08em"
        fill="var(--muted)"
      >
        {caption.toUpperCase()}
      </text>
      <text x={column.cx} y={37} textAnchor="middle" fontSize={15} fontWeight={700} fill="var(--fg)">
        {name}
      </text>
      <text x={column.cx} y={55} textAnchor="middle" fontSize={10.5} fill="var(--muted)">
        {detail}
      </text>
      {badge && <HeaderBadge x={column.cx} badge={badge} />}
    </g>
  )
}

/** Corner radius of a rotor body (its ring strip is clipped to it). */
const DRUM_RADIUS = 14

function Body({ column, top, bottom, radius }: { column: Column; top: number; bottom: number; radius: number }) {
  return (
    <rect
      x={column.x0}
      y={top}
      width={column.x1 - column.x0}
      height={bottom - top}
      rx={radius}
      fill="var(--surface)"
      stroke="var(--border)"
    />
  )
}

/** Column bodies, all faint wiring, contacts and headers. Re-renders only when the model changes. */
const StaticBase = memo(function StaticBase({ model }: { model: StaticDiagram }) {
  const { layout, drums, reflector, entry, plugboard, keys } = model
  // useId() may contain characters that break `url(#…)` references.
  const clipPrefix = `wd${useId().replace(/[^\w-]/g, '')}`
  const top = layout.bodyTop
  const bottom = layout.bodyBottom
  const rows = Array.from({ length: ROW_COUNT }, (_, r) => r)
  return (
    <g fontFamily={FONT} data-layer="static">
      {/* Frame connections across the gaps (absolute rows). */}
      <path d={model.frame} stroke="var(--border)" strokeOpacity={0.45} fill="none" />

      <Body column={reflector.column} top={top} bottom={bottom} radius={10} />
      <path d={reflector.arcs} stroke="var(--border)" fill="none" data-wires="reflector" />

      {drums.map((drum) => {
        const strip = drum.column.x1 - RING_STRIP
        let notchMarks = ''
        for (const l of drum.ringLetters) {
          if (l.notch) notchMarks += `M${strip - 4} ${rowY(l.row) - 3}l3.5 3l-3.5 3z`
        }
        // The ring strip is square; clip it to the inside of the rounded body so its
        // corners never poke out past the body's rounded corners.
        const clipId = `${clipPrefix}-ring-${drum.slot}`
        return (
          <g key={drum.slot} data-drum={drum.slot}>
            <Body column={drum.column} top={top} bottom={bottom} radius={DRUM_RADIUS} />
            <clipPath id={clipId}>
              <rect
                x={drum.column.x0 + 0.5}
                y={top + 0.5}
                width={drum.column.x1 - drum.column.x0 - 1}
                height={bottom - top - 1}
                rx={DRUM_RADIUS - 0.5}
              />
            </clipPath>
            <g clipPath={`url(#${clipId})`}>
              <rect
                x={strip}
                y={top}
                width={RING_STRIP}
                height={bottom - top}
                fill="var(--surface-2)"
              />
              <path d={`M${strip} ${top}V${bottom}`} stroke="var(--border)" />
              <rect
                x={strip + 1}
                y={rowY(0) - 9}
                width={RING_STRIP - 3}
                height={18}
                rx={3}
                fill="var(--bg)"
                stroke="var(--border-strong)"
              />
            </g>
            {notchMarks && <path d={notchMarks} fill="var(--muted)" />}
            <path d={drum.wires} stroke="var(--border)" fill="none" data-wires={drum.slot} />
            <ColumnHeader
              column={drum.column}
              caption={drum.caption}
              name={drum.name}
              detail={drum.detail}
              badge={drum.badge}
            />
          </g>
        )
      })}

      <Body column={entry.column} top={top} bottom={bottom} radius={6} />
      <path d={entry.wires} stroke="var(--border)" fill="none" data-wires="entry" />

      <Body column={plugboard.column} top={top} bottom={bottom} radius={8} />
      <path d={plugboard.plain} stroke="var(--border)" fill="none" data-wires="plugboard" />
      {plugboard.plugged && (
        <path
          d={plugboard.plugged}
          stroke="var(--border-strong)"
          strokeWidth={1.25}
          fill="none"
          data-wires="plugboard-cables"
        />
      )}

      <Body column={keys.column} top={top} bottom={bottom} radius={8} />
      {rows.map((r) => (
        <circle
          key={r}
          cx={layout.keyDotX}
          cy={rowY(r)}
          r={KEY_DOT_RADIUS}
          fill="var(--bg)"
          stroke="var(--border-strong)"
        />
      ))}

      <path d={model.contacts} stroke="var(--border-strong)" fill="none" />

      <ColumnHeader
        column={reflector.column}
        caption={reflector.caption}
        name={reflector.name}
        detail={reflector.detail}
      />
      <ColumnHeader column={entry.column} caption="Entry" name="ETW" detail="identity" />
      <ColumnHeader
        column={plugboard.column}
        caption="Stecker"
        name="Plugboard"
        detail={plugboard.detail}
      />
      <ColumnHeader column={keys.column} caption="Operator" name="Keys" detail="& lamps" />

      {rows.map((r) => (
        <g key={r} fontSize={11} fill="var(--muted)" textAnchor="middle">
          <text x={GUTTER / 2} y={rowY(r) + 4}>
            {toChar(r)}
          </text>
          <text x={layout.width - GUTTER / 2} y={rowY(r) + 4}>
            {toChar(r)}
          </text>
        </g>
      ))}
    </g>
  )
})

/** Alphabet-ring letters, drawn above the active path with a halo so they stay legible. */
const RingLetters = memo(function RingLetters({ model }: { model: StaticDiagram }) {
  return (
    <g
      fontFamily={FONT}
      fontSize={9.5}
      textAnchor="middle"
      strokeWidth={3}
      strokeLinejoin="round"
      paintOrder="stroke"
      data-layer="ring-letters"
    >
      {model.drums.map((drum) => {
        const x = drum.column.x1 - RING_STRIP / 2 - 0.5
        return (
          <g key={drum.slot} aria-hidden="true">
            {drum.ringLetters.map((l) => (
              <text
                key={l.row}
                x={x}
                y={rowY(l.row) + 3.5}
                fill={l.window ? 'var(--fg)' : 'var(--muted)'}
                stroke={l.window ? 'var(--bg)' : 'var(--surface-2)'}
                fontWeight={l.window ? 700 : 400}
              >
                {l.letter}
              </text>
            ))}
          </g>
        )
      })}
    </g>
  )
})

/* ------------------------------------------------------------------------ */
/* Active layers (re-render on playback ticks)                               */
/* ------------------------------------------------------------------------ */

function usePlaybackView() {
  return useEnigmaStore(
    useShallow((s) => ({
      cursor: s.stageCursor,
      animate: s.options.animate,
      speed: s.options.speed,
    })),
  )
}

const ActivePaths = memo(function ActivePaths({
  active,
  traceKey,
}: {
  active: ActivePath
  traceKey: string
}) {
  const { cursor, animate, speed } = usePlaybackView()
  const perStage = useMemo(() => {
    const counts = new Map<number, number>()
    for (const s of active.segments) counts.set(s.stageIndex, (counts.get(s.stageIndex) ?? 0) + 1)
    return counts
  }, [active])

  const visible = cursor ?? Number.POSITIVE_INFINITY
  const latest = cursor === null ? -1 : cursor - 1
  const drawMs = speed * 0.8

  return (
    <g fill="none" strokeLinejoin="round" data-layer="active">
      {active.segments
        .filter((seg) => seg.stageIndex < visible)
        .map((seg) => {
          const animated = animate && seg.stageIndex === latest
          const n = perStage.get(seg.stageIndex) ?? 1
          const style = animated ? timing(drawMs / n, (drawMs / n) * seg.order) : undefined
          const color = TONE_COLOR[seg.tone]
          return (
            <g
              key={`${traceKey}:${seg.id}`}
              data-segment={seg.id}
              data-stage={seg.stageIndex}
              data-tone={seg.tone}
            >
              <path
                d={seg.d}
                stroke={color}
                strokeOpacity={0.18}
                strokeWidth={8}
                strokeLinecap="round"
                pathLength={1}
                className={animated ? 'sp-draw' : undefined}
                style={style}
              />
              <path
                d={seg.d}
                stroke={color}
                strokeWidth={2.75}
                strokeLinecap={animated ? 'butt' : 'round'}
                pathLength={1}
                className={animated ? 'sp-draw' : undefined}
                style={style}
              />
            </g>
          )
        })}
    </g>
  )
})

const ActiveMarks = memo(function ActiveMarks({
  active,
  width,
  keyDotX,
}: {
  active: ActivePath
  width: number
  keyDotX: number
}) {
  const { cursor, animate, speed } = usePlaybackView()
  const visible = cursor ?? Number.POSITIVE_INFINITY
  const latest = cursor === null ? -1 : cursor - 1
  const drawMs = speed * 0.8
  const fade = (stage: number, at: number) =>
    animate && stage === latest ? { className: 'sp-fade', style: timing(0, drawMs * at) } : {}

  const head =
    cursor !== null && latest >= 0
      ? active.segments.filter((s) => s.stageIndex === latest).at(-1)
      : undefined

  const keyShown = active.keyStage < visible
  const lampShown = active.lampStage < visible

  return (
    <g fontFamily={FONT} data-layer="marks">
      {active.badges
        .filter((b) => b.stageIndex < visible)
        .map((b) => (
          <g
            key={b.id}
            data-badge-stage={b.stageIndex}
            data-tone={b.tone}
            {...fade(b.stageIndex, 0.6)}
          >
            <rect
              x={b.x - 9}
              y={b.y - 7.5}
              width={18}
              height={15}
              rx={4}
              fill={TONE_COLOR[b.tone]}
              stroke="var(--bg)"
            />
            <text
              x={b.x}
              y={b.y + 3.8}
              textAnchor="middle"
              fontSize={10.5}
              fontWeight={700}
              fill="var(--bg)"
            >
              {b.letter}
            </text>
          </g>
        ))}

      {keyShown && (
        <g data-key={toChar(active.key)} {...fade(active.keyStage, 0)}>
          <circle cx={keyDotX} cy={rowY(active.key)} r={KEY_DOT_RADIUS + 1} fill="var(--signal-in)" />
          <text
            x={keyDotX + 10}
            y={rowY(active.key) + 3.5}
            fontSize={10}
            fontWeight={700}
            fill="var(--signal-in)"
          >
            key
          </text>
          <text
            x={width - GUTTER / 2}
            y={rowY(active.key) + 4}
            textAnchor="middle"
            fontSize={11}
            fontWeight={800}
            fill="var(--signal-in)"
            stroke="var(--bg)"
            strokeWidth={3}
            paintOrder="stroke"
          >
            {toChar(active.key)}
          </text>
        </g>
      )}

      {lampShown && (
        <g data-lamp={toChar(active.lamp)} {...fade(active.lampStage, 0.8)}>
          <circle cx={keyDotX} cy={rowY(active.lamp)} r={11} fill="var(--lamp)" fillOpacity={0.45} />
          <circle
            cx={keyDotX}
            cy={rowY(active.lamp)}
            r={KEY_DOT_RADIUS + 1}
            fill="var(--lamp)"
            stroke="var(--signal-out)"
            strokeWidth={2}
          />
          <text
            x={keyDotX + 10}
            y={rowY(active.lamp) + 3.5}
            fontSize={10}
            fontWeight={700}
            fill="var(--signal-out)"
          >
            lamp
          </text>
          <text
            x={width - GUTTER / 2}
            y={rowY(active.lamp) + 4}
            textAnchor="middle"
            fontSize={11}
            fontWeight={800}
            fill="var(--signal-out)"
            stroke="var(--bg)"
            strokeWidth={3}
            paintOrder="stroke"
          >
            {toChar(active.lamp)}
          </text>
        </g>
      )}

      {head && (
        <g
          key={`head-${latest}`}
          data-signal-head={latest}
          {...(animate ? { className: 'sp-fade', style: timing(0, drawMs * 0.9) } : {})}
        >
          <circle
            cx={head.to.x}
            cy={head.to.y}
            r={9}
            fill={TONE_COLOR[head.tone]}
            className="sp-pulse"
          />
          <circle
            cx={head.to.x}
            cy={head.to.y}
            r={3.5}
            fill={TONE_COLOR[head.tone]}
            stroke="var(--bg)"
            strokeWidth={1.5}
          />
        </g>
      )}
    </g>
  )
})

/* ------------------------------------------------------------------------ */
/* Diagram                                                                   */
/* ------------------------------------------------------------------------ */

function describe(trace: KeypressTrace | null, settings: MachineSettings): string {
  if (!trace) return 'No key pressed yet: the diagram shows the wiring at the start positions.'
  const hops = trace.stages
    .slice(1)
    .map((stage) => `${shortStageLabel(stage, settings)} ${toChar(stage.output)}`)
  return `Key ${toChar(trace.input)} → ${hops.join(' → ')}.`
}

export interface WiringDiagramProps {
  className?: string
}

/**
 * SVG wiring diagram: every component's 26 wires (faint) for the visualised key press,
 * plus the active signal path revealed stage by stage.
 */
export function WiringDiagram({ className }: WiringDiagramProps) {
  const settings = useEnigmaStore((s) => s.settings)
  const ringDisplay = useEnigmaStore((s) => s.options.ringDisplay)
  const trace = useActiveTrace()
  const titleId = useId()
  const descId = useId()

  const model = useMemo(
    () => buildStaticDiagram(settings, trace, ringDisplay),
    [settings, trace, ringDisplay],
  )
  const { layout } = model
  const active = useMemo(() => (trace ? buildActivePath(layout, trace) : null), [layout, trace])
  const traceKey = trace ? `${trace.index}:${trace.input}` : ''

  return (
    <div className={cn('relative', className)}>
      <div
        role="region"
        aria-label="Wiring diagram (scrolls horizontally)"
        tabIndex={0}
        className={cn('overflow-x-auto rounded-md border border-border bg-bg', focusRing)}
      >
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width="100%"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="mx-auto block h-auto select-none"
          style={{ minWidth: layout.width, maxWidth: Math.round(layout.width * 1.2) }}
          data-columns={layout.columns.map((c) => c.id).join(' ')}
        >
          <title id={titleId}>Enigma wiring diagram</title>
          <desc id={descId}>{describe(trace, settings)}</desc>
          <style>{DIAGRAM_CSS}</style>
          <StaticBase model={model} />
          {active && <ActivePaths active={active} traceKey={traceKey} />}
          <RingLetters model={model} />
          {active && <ActiveMarks active={active} width={layout.width} keyDotX={layout.keyDotX} />}
        </svg>
      </div>
      {!trace && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
          <p className="rounded-md border border-border bg-bg/90 px-3 py-1.5 text-center text-muted shadow-cell">
            Press a key to see the signal path
          </p>
        </div>
      )}
    </div>
  )
}
