import { useId, useMemo, useState } from 'react'
import { Collapsible } from 'radix-ui'
import { CheckIcon, ChevronDownIcon, CircleXIcon, CopyIcon } from 'lucide-react'
import { REFLECTORS, encodeSettings } from '../../lib/enigma'
import { navigate } from '../../lib/hash-route'
import { cn } from '../../lib/cn'
import { readableText } from '../../lib/breaker/readable'
import type { BreakerCandidate, BreakerLanguage, SampleChallenge } from '../../lib/breaker/types'
import { useEnigmaStore } from '../../state'
import { Badge, Button, InfoTip, ToggleGroup, ToggleGroupItem, controlBase, focusRing } from '../ui'
import type { BadgeVariant } from '../ui'
import { useCopyFeedback } from '../use-copy-feedback'
import {
  CONFIDENCE_LABELS,
  confidenceOf,
  formatIoc,
  formatPercent,
  formatScore,
  letterAgreement,
  ringsLabel,
  rotorsLabel,
  startLabel,
  viewPlaintext,
} from './format'
import type { Confidence, PlaintextView } from './format'
import { letters, safeDescribe } from './safe-engine'
import { useReadableDictionary } from './use-readable-dictionary'

const PREVIEW_LETTERS = 24

const CONFIDENCE_BADGE: Record<Confidence, BadgeVariant> = {
  language: 'primary',
  partial: 'outline',
  wrong: 'muted',
}

const VIEWS: { value: PlaintextView; label: string }[] = [
  { value: 'readable', label: 'Readable' },
  { value: 'fives', label: 'Groups of 5' },
  { value: 'raw', label: 'Letters' },
]

/** Same cell look as the simulator's "Rotors:" table. */
const CELL = 'border-r border-b border-border last:border-r-0'
const STICKY = 'sticky left-0 z-[1]'

export interface BreakerResultsProps {
  candidates: BreakerCandidate[]
  /** Ciphertext of the run that produced the candidates (loaded into the simulator). */
  ciphertext: string
  /** The example whose hidden key can be compared once the run has finished. */
  example: SampleChallenge | null
  finished: boolean
  /** Plaintext language of the run (picks the Readable view's word list). */
  language: BreakerLanguage
  className?: string
}

/** "Best candidate:" card plus the "Candidates:" table; selecting a row shows it in the card. */
export function BreakerResults({
  candidates,
  ciphertext,
  example,
  finished,
  language,
  className,
}: BreakerResultsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIndex = Math.max(
    0,
    candidates.findIndex((c) => c.id === selectedId),
  )
  const selected = candidates[selectedIndex]
  if (!selected) return null

  return (
    <section aria-label="Results" className={cn('flex min-w-0 flex-col gap-8', className)}>
      {example && finished && <ExampleCheck example={example} best={candidates[0]} />}
      <CandidateCard candidate={selected} rank={selectedIndex + 1} ciphertext={ciphertext} language={language} />
      <CandidatesTable
        candidates={candidates}
        selectedId={selected.id}
        onSelect={(id) => setSelectedId(id)}
      />
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Example verification                                                */
/* ------------------------------------------------------------------ */

function ExampleCheck({ example, best }: { example: SampleChallenge; best: BreakerCandidate }) {
  const agreement = letterAgreement(best.plaintext, letters(example.plaintext))
  const match = agreement >= 0.98
  const percent = Math.round(agreement * 100)
  const [open, setOpen] = useState(false)
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="rounded-md border border-border">
      <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <p className="flex items-center gap-2 font-semibold" role="status">
          {match ? (
            <CheckIcon aria-hidden className="size-5 shrink-0 text-signal-out" />
          ) : (
            <CircleXIcon aria-hidden className="size-5 shrink-0 text-signal-in" />
          )}
          {match
            ? 'Matches the hidden key: the example is broken.'
            : `Differs from the hidden key (${percent}% of letters agree).`}
        </p>
        <Collapsible.Trigger
          className={cn(
            'group inline-flex items-center gap-1 self-start rounded-sm border border-transparent text-sm underline underline-offset-2 sm:self-auto',
            focusRing,
          )}
        >
          {open ? 'Hide the hidden key' : 'Show the hidden key'}
          <ChevronDownIcon aria-hidden className="size-4 transition-transform group-data-[state=open]:rotate-180" />
        </Collapsible.Trigger>
      </div>
      <Collapsible.Content className="border-t border-border px-3 py-3 text-sm sm:px-4">
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted">Hidden key</dt>
          <dd className="font-semibold wrap-anywhere">{safeDescribe(example.settings)}</dd>
          <dt className="text-muted">Source</dt>
          <dd>{example.source}</dd>
          <dt className="text-muted">Plaintext</dt>
          <dd className="tracking-wide wrap-anywhere">{example.plaintext}</dd>
        </dl>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

/* ------------------------------------------------------------------ */
/* Candidate card                                                      */
/* ------------------------------------------------------------------ */

function CandidateCard({
  candidate,
  rank,
  ciphertext,
  language,
}: {
  candidate: BreakerCandidate
  rank: number
  ciphertext: string
  language: BreakerLanguage
}) {
  const id = useId()
  const [view, setView] = useState<PlaintextView>('readable')
  const keyCopy = useCopyFeedback()
  const confidence = confidenceOf(candidate.ioc, candidate.words?.coverage)
  const dictionary = useReadableDictionary(language)
  const text = useMemo(
    () =>
      view === 'readable' && dictionary
        ? readableText(candidate.plaintext, dictionary)
        : viewPlaintext(candidate.plaintext, view, candidate.words?.segmented),
    [candidate.plaintext, candidate.words?.segmented, view, dictionary],
  )

  const openInSimulator = () => {
    const store = useEnigmaStore.getState()
    store.loadSettings(candidate.settings)
    store.setInput(ciphertext)
    navigate('simulator')
  }

  return (
    <div className="flex min-w-0 flex-col">
      <span className="mb-2 inline-flex items-center gap-1">
        <span id={`${id}-title`}>{rank === 1 ? 'Best candidate:' : `Candidate #${rank}:`}</span>
        <InfoTip label="Candidate">
          <p>The decrypt with this key, its key and how language-like it looks.</p>
          <p>
            IoC (index of coincidence) is the chance that two random letters of the text match:
            about 0.066 for English, 0.076 for German, 0.038 for random letters.
          </p>
          <p>
            Words is the share of letters that form dictionary words (allowing small typos). The
            right key usually reaches 85–100%; wrong keys stay below about 30%.
          </p>
        </InfoTip>
      </span>
      <div
        role="group"
        aria-labelledby={`${id}-title`}
        className="flex min-w-0 flex-col gap-4 rounded-md border border-border p-3 sm:p-4"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge variant={CONFIDENCE_BADGE[confidence]} className="text-sm">
            {CONFIDENCE_LABELS[confidence]}
          </Badge>
          <span className="text-sm text-muted tabular-nums">
            Score <span className="font-semibold text-fg">{formatScore(candidate.score)}</span> · IoC{' '}
            <span className="font-semibold text-fg">{formatIoc(candidate.ioc)}</span>
            {candidate.words && (
              <>
                {' '}
                · Words <span className="font-semibold text-fg">{formatPercent(candidate.words.coverage)}</span>
                {candidate.words.typos > 0 && (
                  <>
                    {' '}
                    ({candidate.words.typos} {candidate.words.typos === 1 ? 'typo' : 'typos'})
                  </>
                )}
              </>
            )}
          </span>
        </div>

        <p className="font-semibold wrap-anywhere">
          <span className="sr-only">Key: </span>
          {safeDescribe(candidate.settings)}
        </p>

        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span id={`${id}-plain`} className="text-sm text-muted">
              Plaintext ({candidate.plaintext.length} letters):
            </span>
            <ToggleGroup
              type="single"
              aria-label="Plaintext view"
              value={view}
              onValueChange={(v) => {
                if (v) setView(v as PlaintextView)
              }}
            >
              {VIEWS.map((v) => (
                <ToggleGroupItem key={v.value} value={v.value} size="sm">
                  {v.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div
            role="textbox"
            aria-readonly="true"
            aria-multiline="true"
            aria-labelledby={`${id}-plain`}
            tabIndex={0}
            className={cn(
              controlBase,
              focusRing,
              'max-h-64 min-h-24 overflow-y-auto tracking-wider whitespace-pre-wrap wrap-anywhere',
            )}
          >
            {text}
          </div>
          {view === 'readable' && (
            <p className="text-xs text-muted">
              Readable splits the text into the most likely words, preferring common ones; German operators keyed X between words and for full stops.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="primary" className="w-full sm:w-auto" onClick={openInSimulator}>
            Open in simulator
          </Button>
          <Button
            className="w-full sm:w-auto"
            onClick={() => void keyCopy.copy(encodeSettings(candidate.settings))}
          >
            {keyCopy.status === 'copied' ? (
              <CheckIcon aria-hidden className="size-4" />
            ) : keyCopy.status === 'failed' ? (
              <CircleXIcon aria-hidden className="size-4" />
            ) : (
              <CopyIcon aria-hidden className="size-4" />
            )}
            {keyCopy.status === 'copied'
              ? 'Copied!'
              : keyCopy.status === 'failed'
                ? 'Copy failed'
                : 'Copy key'}
          </Button>
        </div>
        <span role="status" aria-live="polite" className="sr-only">
          {keyCopy.status === 'copied' ? 'Key copied to the clipboard.' : ''}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Candidates table                                                    */
/* ------------------------------------------------------------------ */

function CandidatesTable({
  candidates,
  selectedId,
  onSelect,
}: {
  candidates: BreakerCandidate[]
  selectedId: string
  onSelect(id: string): void
}) {
  const id = useId()
  const head = cn(CELL, 'px-2 py-2 leading-5 font-bold whitespace-nowrap')
  return (
    <div className="flex min-w-0 flex-col">
      <span id={`${id}-label`} className="mb-2 inline-block">
        Candidates:
      </span>
      <div className="overflow-x-auto rounded-md border border-border">
        <table
          aria-labelledby={`${id}-label`}
          className="w-full min-w-[50rem] border-separate border-spacing-0 text-center"
        >
          <thead>
            <tr>
              <th scope="col" className={cn(head, STICKY, 'bg-bg')}>
                #
              </th>
              <th scope="col" className={head}>
                Rotors
              </th>
              <th scope="col" className={head}>
                Reflector
              </th>
              <th scope="col" className={head}>
                Rings
              </th>
              <th scope="col" className={head}>
                Start
              </th>
              <th scope="col" className={head}>
                Plugs
              </th>
              <th scope="col" className={head}>
                Score
              </th>
              <th scope="col" className={head}>
                Words
              </th>
              <th scope="col" className={cn(head, 'text-left')}>
                Preview
              </th>
            </tr>
          </thead>
          <tbody className="[&>tr:last-child>*]:border-b-0">
            {candidates.map((c, i) => {
              const selected = c.id === selectedId
              const bg = selected ? 'bg-surface-2' : 'bg-bg group-hover:bg-surface'
              const cell = cn(CELL, bg, 'px-2 py-2 leading-6 whitespace-nowrap')
              return (
                <tr
                  key={c.id}
                  data-selected={selected ? '' : undefined}
                  onClick={() => onSelect(c.id)}
                  className="group cursor-pointer"
                >
                  <th scope="row" className={cn(CELL, bg, STICKY, 'p-0 font-bold')}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={`Show candidate ${i + 1}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect(c.id)
                      }}
                      className={cn(
                        'flex h-10 w-full min-w-10 items-center justify-center rounded-none border border-transparent px-2 tabular-nums',
                        focusRing,
                      )}
                    >
                      {i + 1}
                    </button>
                  </th>
                  <td className={cn(cell, 'font-medium')}>{rotorsLabel(c.settings)}</td>
                  <td className={cell}>{REFLECTORS[c.settings.reflector]?.name ?? c.settings.reflector}</td>
                  <td className={cn(cell, 'tabular-nums')}>{ringsLabel(c.settings)}</td>
                  <td className={cn(cell, 'tracking-wider')}>{startLabel(c.settings)}</td>
                  <td className={cn(cell, 'tabular-nums')}>{c.settings.plugboard.length}</td>
                  <td className={cn(cell, 'tabular-nums')}>{formatScore(c.score)}</td>
                  <td className={cn(cell, 'tabular-nums')}>{c.words ? formatPercent(c.words.coverage) : '—'}</td>
                  <td className={cn(cell, 'text-left font-mono text-sm tracking-widest')}>
                    {c.plaintext.slice(0, PREVIEW_LETTERS)}
                    {c.plaintext.length > PREVIEW_LETTERS ? '…' : ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-sm text-muted">Select a row to show that candidate above.</p>
    </div>
  )
}
