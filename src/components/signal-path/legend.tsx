import { cn } from '../../lib/cn'

function Swatch({ color, width, opacity = 1 }: { color: string; width: number; opacity?: number }) {
  return (
    <svg aria-hidden width={28} height={10} viewBox="0 0 28 10" className="shrink-0">
      <path
        d="M2 5H26"
        stroke={color}
        strokeWidth={width}
        strokeOpacity={opacity}
        strokeLinecap="round"
      />
    </svg>
  )
}

export interface LegendProps {
  className?: string
}

/** Colour key of the wiring diagram. */
export function Legend({ className }: LegendProps) {
  return (
    <ul
      aria-label="Legend"
      className={cn('flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted', className)}
    >
      <li className="flex items-center gap-2">
        <Swatch color="var(--signal-in)" width={3} />
        towards reflector
      </li>
      <li className="flex items-center gap-2">
        <Swatch color="var(--signal-out)" width={3} />
        back to lamps
      </li>
      <li className="flex items-center gap-2">
        <Swatch color="var(--border-strong)" width={1.5} />
        other wires
      </li>
      <li className="flex items-center gap-2">
        <svg aria-hidden width={12} height={12} viewBox="0 0 12 12" className="shrink-0">
          <path d="M3 2l5 4l-5 4z" fill="var(--muted)" />
        </svg>
        notch letter
      </li>
    </ul>
  )
}
