import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../lib/cn'
import { toChar } from '../lib/enigma'
import type { KeypressTrace } from '../lib/enigma'
import { useActiveTraceIndex, useEnigmaResult, useEnigmaStore } from '../state'
import {
  Button,
  Cell,
  Hint,
  InputGroup,
  InfoTip,
  InputGroupText,
  Label,
  Switch,
  Textarea,
  controlBase,
  controlFocus,
} from './ui'

/** Above this many output characters the output box renders plain text (no per-letter spans). */
const MAX_INTERACTIVE_OUTPUT = 2000
/** At most this many keystrokes are rendered on the aligned tape. */
const MAX_TAPE = 500
const COPIED_MS = 1500

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

interface OutputPart {
  text: string
  /** Index of the key press trace that produced this letter; null for passthrough text. */
  trace: number | null
}

/**
 * Splits the output into letter parts (mapped to their trace) and passthrough runs.
 * With `group`, letters are shown in blocks of five: spaces/tabs are dropped, line breaks
 * are kept (and restart the count), punctuation stays where it was.
 */
function buildOutputParts(
  output: string,
  outputToTrace: readonly (number | null)[],
  group: boolean,
): OutputPart[] {
  const parts: OutputPart[] = []
  let plain = ''
  let lastEmitted = ''
  let letters = 0
  const flush = () => {
    if (plain === '') return
    parts.push({ text: plain, trace: null })
    plain = ''
  }
  for (let i = 0; i < output.length; i++) {
    const ch = output[i]
    const trace = outputToTrace[i] ?? null
    if (trace === null) {
      if (group) {
        if (ch === '\n') letters = 0
        else if (/\s/.test(ch)) continue
      }
      plain += ch
      lastEmitted = ch
      continue
    }
    if (group && letters > 0 && letters % 5 === 0 && !/\s/.test(lastEmitted)) plain += ' '
    flush()
    parts.push({ text: ch, trace })
    lastEmitted = ch
    letters++
  }
  flush()
  return parts
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** Index of the trace under a click target (`data-trace` / `data-index`), or null. */
function traceFromEvent(e: MouseEvent<HTMLElement>, attr: 'trace' | 'index'): number | null {
  const target = e.target as Element | null
  const el = target?.closest<HTMLElement>(`[data-${attr}]`)
  if (!el || !e.currentTarget.contains(el)) return null
  const value = Number(el.dataset[attr])
  return Number.isInteger(value) ? value : null
}

/** "1 letter" / "5 letters" for screen readers. */
function lettersLabel(n: number): string {
  return `${n} enciphered ${n === 1 ? 'letter' : 'letters'}`
}

/* ------------------------------------------------------------------------------------------------
 * Input
 * ---------------------------------------------------------------------------------------------- */

function InputPanel({ count }: { count: number }) {
  const input = useEnigmaStore((s) => s.input)
  const setInput = useEnigmaStore((s) => s.setInput)
  const id = useId()
  const textareaId = `${id}-input`
  const countId = `${id}-count`
  return (
    <div className="flex min-w-0 flex-col">
      <span className="mb-2 inline-flex items-center gap-1">
        <Label htmlFor={textareaId} className="mb-0">
          Input:
        </Label>
        <InfoTip label="Input">
          <p>
            Text to send through the machine. Each letter is one key press and advances the rotors.
          </p>
          <p>
            Enigma is reciprocal: paste ciphertext here with the same settings and start positions
            to get the plaintext back.
          </p>
        </InfoTip>
      </span>
      <InputGroup>
        <Textarea
          id={textareaId}
          rows={4}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type or paste text… e.g. HELLO WORLD"
          aria-describedby={countId}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          className="min-h-27.5"
        />
        <InputGroupText id={countId}>
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">{lettersLabel(count)}</span>
        </InputGroupText>
      </InputGroup>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Output
 * ---------------------------------------------------------------------------------------------- */

type CopyStatus = 'idle' | 'copied' | 'failed'

/** Clipboard copy with a transient status ('copied' / 'failed' for COPIED_MS). */
function useCopy(): [CopyStatus, (text: string) => Promise<void>] {
  const [status, setStatus] = useState<CopyStatus>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const copy = useCallback(async (text: string) => {
    const ok = await writeClipboard(text)
    setStatus(ok ? 'copied' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus('idle'), COPIED_MS)
  }, [])

  return [status, copy]
}

function copyMessage(status: CopyStatus): string {
  return status === 'copied' ? 'Copied!' : status === 'failed' ? 'Copy failed' : ''
}

function CopyButton({
  status,
  disabled,
  onCopy,
}: {
  status: CopyStatus
  disabled: boolean
  onCopy: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <Hint
      content={copyMessage(status) || 'Copy output'}
      open={!disabled && (hover || status !== 'idle')}
      onOpenChange={setHover}
    >
      <Button size="icon" aria-label="Copy output" disabled={disabled} onClick={onCopy}>
        {status === 'copied' ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      </Button>
    </Hint>
  )
}

function OutputPanel({ count, activeIndex }: { count: number; activeIndex: number | null }) {
  const result = useEnigmaResult()
  const group = useEnigmaStore((s) => s.options.groupOutput)
  const selectTrace = useEnigmaStore((s) => s.selectTrace)
  const id = useId()
  const labelId = `${id}-label`
  const countId = `${id}-count`
  const [copyStatus, copy] = useCopy()

  const parts = useMemo(
    () => buildOutputParts(result.output, result.outputToTrace, group),
    [result, group],
  )
  const text = useMemo(() => parts.map((p) => p.text).join(''), [parts])
  const interactive = text.length <= MAX_INTERACTIVE_OUTPUT

  const nodes = useMemo(() => {
    if (!interactive) return text
    return parts.map((p) =>
      p.trace === null ? (
        p.text
      ) : (
        <span
          key={p.trace}
          data-trace={p.trace}
          data-active={p.trace === activeIndex ? '' : undefined}
          className={cn(
            'cursor-pointer rounded-sm hover:bg-surface',
            p.trace === activeIndex && 'bg-surface-2 hover:bg-surface-2',
          )}
        >
          {p.text}
        </span>
      ),
    )
  }, [parts, text, interactive, activeIndex])

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const index = traceFromEvent(e, 'trace')
    if (index !== null) selectTrace(index)
  }

  return (
    <div className="flex min-w-0 flex-col">
      <span className="mb-2 inline-flex items-center gap-1">
        <span id={labelId}>Output:</span>
        <InfoTip label="Output">
          <p>The enciphered text, updated as you type. The number shows how many letters went through the machine.</p>
          <p>Click a letter to show its path through the machine below. The copy button copies the whole output.</p>
        </InfoTip>
      </span>
      <InputGroup>
        <div
          role="textbox"
          aria-readonly="true"
          aria-multiline="true"
          aria-labelledby={labelId}
          aria-describedby={countId}
          tabIndex={0}
          onClick={onClick}
          className={cn(
            controlBase,
            controlFocus,
            'max-h-80 min-h-27.5 flex-1 overflow-y-auto tracking-wider whitespace-pre-wrap wrap-anywhere',
          )}
        >
          {text === '' ? (
            <span className="font-normal tracking-normal text-muted">
              The enciphered text appears here.
            </span>
          ) : (
            nodes
          )}
        </div>
        <InputGroupText id={countId}>
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">{lettersLabel(count)}</span>
        </InputGroupText>
        <CopyButton status={copyStatus} disabled={text === ''} onCopy={() => copy(text)} />
      </InputGroup>
      <span className="sr-only" role="status" aria-live="polite">
        {copyMessage(copyStatus)}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Options
 * ---------------------------------------------------------------------------------------------- */

function OptionsRow() {
  const { nonLetters, groupOutput } = useEnigmaStore(
    useShallow((s) => ({ nonLetters: s.options.nonLetters, groupOutput: s.options.groupOutput })),
  )
  const setOption = useEnigmaStore((s) => s.setOption)
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      <Switch
        label="Keep spaces & punctuation"
        info="On: spaces, digits and punctuation are copied to the output unchanged. Off: they are dropped. Either way they never step the rotors."
        checked={nonLetters === 'keep'}
        onCheckedChange={(checked) => setOption('nonLetters', checked ? 'keep' : 'remove')}
      />
      <Switch
        label="Group output in fives"
        info="Shows the output in blocks of five letters, as operators transmitted it. Display only; copying gives the grouped text."
        checked={groupOutput}
        onCheckedChange={(checked) => setOption('groupOutput', checked)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Keystroke tape
 * ---------------------------------------------------------------------------------------------- */

interface TapeColumnProps {
  index: number
  plain: string
  cipher: string
  active: boolean
  first: boolean
  last: boolean
  showIndex: boolean
}

const tapeCell = 'size-9 rounded-none text-base group-hover:z-5 group-hover:border-border-strong'

const TapeColumn = memo(function TapeColumn({
  index,
  plain,
  cipher,
  active,
  first,
  last,
  showIndex,
}: TapeColumnProps) {
  return (
    <div
      role="option"
      aria-selected={active}
      aria-label={`Keystroke ${index + 1}: ${plain} enciphered to ${cipher}`}
      tabIndex={active ? 0 : -1}
      data-index={index}
      className={cn(
        'group relative flex shrink-0 cursor-pointer flex-col rounded-md outline-none',
        !first && '-ml-0.5',
        active ? 'z-10' : 'hover:z-5',
      )}
    >
      <span
        aria-hidden="true"
        className="h-4 text-center text-[0.625rem] leading-4 text-muted tabular-nums"
      >
        {showIndex ? index + 1 : ''}
      </span>
      <Cell
        aria-hidden="true"
        active={active}
        className={cn(tapeCell, first && 'rounded-tl-md', last && 'rounded-tr-md')}
      >
        {plain}
      </Cell>
      <Cell
        aria-hidden="true"
        active={active}
        className={cn(
          tapeCell,
          '-mt-0.5 font-semibold',
          first && 'rounded-bl-md',
          last && 'rounded-br-md',
        )}
      >
        {cipher}
      </Cell>
    </div>
  )
})

/** First rendered keystroke: the last MAX_TAPE ones, shifted back when an older one is active. */
function tapeStart(count: number, activeIndex: number | null): number {
  if (count <= MAX_TAPE) return 0
  const tail = count - MAX_TAPE
  if (activeIndex !== null && activeIndex < tail) {
    return Math.max(0, Math.min(tail, activeIndex - Math.floor(MAX_TAPE / 2)))
  }
  return tail
}

function KeystrokeTape({
  traces,
  activeIndex,
}: {
  traces: readonly KeypressTrace[]
  activeIndex: number | null
}) {
  const selectTrace = useEnigmaStore((s) => s.selectTrace)
  const id = useId()
  const labelId = `${id}-label`
  const listRef = useRef<HTMLDivElement>(null)

  const count = traces.length
  const start = tapeStart(count, activeIndex)
  const end = Math.min(count, start + MAX_TAPE)

  const columns = useMemo(() => {
    const out: TapeColumnProps[] = []
    for (let i = start; i < end; i++) {
      const t = traces[i]
      out.push({
        index: i,
        plain: toChar(t.input),
        cipher: toChar(t.output),
        active: false,
        first: i === start,
        last: i === end - 1,
        showIndex: (i + 1) % 5 === 0 || i === start,
      })
    }
    return out
  }, [traces, start, end])

  // Roving focus: keep keyboard focus on the active column while navigating the tape.
  // No auto-scrolling — the tape only moves when the user scrolls it.
  useEffect(() => {
    if (activeIndex === null) return
    const list = listRef.current
    const el = list?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    if (el && list && list.contains(document.activeElement) && document.activeElement !== el) {
      el.focus({ preventScroll: true })
    }
  }, [activeIndex])

  const onClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const index = traceFromEvent(e, 'index')
      if (index !== null) selectTrace(index)
    },
    [selectTrace],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (activeIndex === null || e.altKey || e.ctrlKey || e.metaKey) return
    let next: number
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        next = activeIndex - 1
        break
      case 'ArrowRight':
      case 'ArrowDown':
        next = activeIndex + 1
        break
      case 'PageUp':
        next = activeIndex - 10
        break
      case 'PageDown':
        next = activeIndex + 10
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = count - 1
        break
      default:
        return
    }
    e.preventDefault()
    selectTrace(Math.max(0, Math.min(count - 1, next)))
  }

  const note =
    count > MAX_TAPE
      ? start === count - MAX_TAPE
        ? `Showing the last ${MAX_TAPE} of ${count}`
        : `Showing ${start + 1}–${end} of ${count}`
      : null

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="mb-2 inline-flex items-center gap-1">
          <span id={labelId}>Keystrokes:</span>
          <InfoTip label="Keystrokes">
            Every key press with its input letter (In) and the letter it became (Out). Click a column,
            or use the arrow keys, to show that key press in the signal path.
          </InfoTip>
        </span>
        {note && <span className="mb-2 text-sm text-muted">{note}</span>}
      </div>
      {count === 0 ? (
        <p className="text-muted">No keys pressed yet.</p>
      ) : (
        <div className="flex min-w-0 items-start gap-2">
          <div
            aria-hidden="true"
            className="flex shrink-0 flex-col pt-5 text-right text-xs leading-9 text-muted"
          >
            <span>In</span>
            <span className="-mt-0.5">Out</span>
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto px-1 pb-2">
            <div
              ref={listRef}
              role="listbox"
              aria-labelledby={labelId}
              aria-orientation="horizontal"
              onClick={onClick}
              onKeyDown={onKeyDown}
              className="flex w-max py-1"
            >
              {columns.map((col) => (
                <TapeColumn key={col.index} {...col} active={col.index === activeIndex} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * TextIO
 * ---------------------------------------------------------------------------------------------- */

export interface TextIOProps {
  className?: string
}

/**
 * Spec §4.5 — text input/output: "Input:" textarea (controlled by store.input), "Output:"
 * read-only box with copy button, the output options and the aligned keystroke tape.
 * Clicking a letter in the output or a tape column selects that key press trace.
 */
export function TextIO({ className }: TextIOProps) {
  const result = useEnigmaResult()
  const activeIndex = useActiveTraceIndex()
  const count = result.traces.length
  return (
    <section aria-label="Text input and output" className={cn('flex flex-col gap-6 text-left', className)}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <InputPanel count={count} />
          <OutputPanel count={count} activeIndex={activeIndex} />
        </div>
        <OptionsRow />
      </div>
      <KeystrokeTape traces={result.traces} activeIndex={activeIndex} />
    </section>
  )
}
