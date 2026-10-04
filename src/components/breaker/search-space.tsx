import { useId } from 'react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import type { BreakerConfig, WorkEstimate } from '../../lib/breaker/types'
import { InfoTip } from '../ui'
import { formatDuration } from './format'
import { computeKeyspace, formatBig, orderOfMagnitudeRatio } from './keyspace'

const CELL = 'border-r border-b border-border px-3 py-2 leading-6 last:border-r-0'

export interface SearchSpaceProps extends Omit<ComponentProps<'section'>, 'children'> {
  config: BreakerConfig
  /** Engine estimate (time for the whole run), when available. */
  estimate: WorkEstimate | null
  /** Who does the work, e.g. "GPU + 10 CPU workers". */
  processors: string
}

/**
 * "Search space:" — every factor of the key space for the chosen options and their
 * product, next to what the codebreaker actually tries in each phase.
 */
export function SearchSpace({ config, estimate, processors, className, ...props }: SearchSpaceProps) {
  const id = useId()
  const space = computeKeyspace(config)
  const valid = space.exhaustive > 0n
  const skipped = orderOfMagnitudeRatio(space.total, space.exhaustive)

  return (
    <section aria-labelledby={`${id}-label`} className={cn('flex min-w-0 flex-col', className)} {...props}>
      <div className="mb-2 flex items-center gap-1">
        <span id={`${id}-label`}>Search space:</span>
        <InfoTip label="Search space">
          <p>
            How many different keys your options allow, and how many the codebreaker really tries.
            Trying them all would take longer than the age of the universe, so it searches the
            rotors exhaustively and climbs towards the right rings and plugboard instead.
          </p>
        </InfoTip>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-separate border-spacing-0 text-left">
            <caption className="sr-only">Possible keys for these options</caption>
            <thead>
              <tr>
                <th scope="col" className={cn(CELL, 'font-bold')}>
                  Factor
                </th>
                <th scope="col" className={cn(CELL, 'text-right font-bold')}>
                  Choices
                </th>
              </tr>
            </thead>
            <tbody>
              {space.factors.map((f) => (
                <tr key={f.id}>
                  <th scope="row" className={cn(CELL, 'font-normal')}>
                    {f.label}
                    <span className="block text-xs text-muted">{f.formula}</span>
                  </th>
                  <td className={cn(CELL, 'text-right tabular-nums')}>{formatBig(f.count)}</td>
                </tr>
              ))}
              <tr className="[&>*]:border-b-0">
                <th scope="row" className={cn(CELL, 'bg-surface-2 font-bold')}>
                  Possible keys
                </th>
                <td className={cn(CELL, 'bg-surface-2 text-right font-bold tabular-nums')}>
                  {valid ? formatBig(space.total) : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <p className="m-0">What the codebreaker tries:</p>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {space.stages.map((stage, i) => (
              <li key={stage.id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-sm font-semibold"
                >
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="font-semibold">{stage.label}</span>
                  {stage.keys !== null && valid && (
                    <span className="tabular-nums"> — {formatBig(stage.keys)} keys</span>
                  )}
                  <span className="block text-sm text-muted">{stage.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          {valid && (
            <p className="m-0 text-sm text-muted">
              That is about <span className="font-semibold text-fg">1 in 10{superscript(skipped)}</span> of
              all possible keys
              {estimate != null && (
                <>
                  {' '}
                  — roughly <span className="font-semibold text-fg">{formatDuration(estimate.seconds)}</span> with{' '}
                  {processors}
                </>
              )}
              .
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function superscript(n: number): string {
  const map = '⁰¹²³⁴⁵⁶⁷⁸⁹'
  return String(n).replace(/\d/g, (d) => map[Number(d)])
}
