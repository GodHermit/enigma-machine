import { useId } from 'react'
import { cn } from '../../lib/cn'
import type { SampleChallenge } from '../../lib/breaker/types'
import { Button, Hint, InfoTip, InputGroup, InputGroupText, Label, Textarea } from '../ui'
import { MIN_LETTERS, SHORT_LETTERS } from './form-state'

export interface CiphertextPanelProps {
  value: string
  letterCount: number
  onChange(value: string): void
  onExample(): void
  onClear(): void
  /** The example currently in the box (its source is named under it). */
  example: SampleChallenge | null
  exampleError: string | null
  error?: string
  disabled?: boolean
  className?: string
}

/** "Ciphertext:" textarea with a letter count, Try an example / Clear and length hints. */
export function CiphertextPanel({
  value,
  letterCount,
  onChange,
  onExample,
  onClear,
  example,
  exampleError,
  error,
  disabled,
  className,
}: CiphertextPanelProps) {
  const id = useId()
  const textareaId = `${id}-text`
  const countId = `${id}-count`
  const hintId = `${id}-hint`
  const showShortHint = letterCount >= MIN_LETTERS && letterCount < SHORT_LETTERS
  const showError = error != null && letterCount > 0

  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <span className="mb-2 inline-flex items-center gap-1">
        <Label htmlFor={textareaId} className="mb-0">
          Ciphertext:
        </Label>
        <InfoTip label="Ciphertext">
          <p>The intercepted message. Only the letters A–Z are used; spaces, digits and punctuation are ignored.</p>
          <p>
            Nothing else is needed: the codebreaker recovers rotors, ring settings, start positions
            and plugboard from the ciphertext alone.
          </p>
        </InfoTip>
      </span>
      <InputGroup>
        <Textarea
          id={textareaId}
          rows={6}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste an intercepted message…"
          aria-describedby={`${countId} ${hintId}`}
          aria-invalid={showError || undefined}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          disabled={disabled}
          className="min-h-36 tracking-wide"
        />
        <InputGroupText id={countId} className="items-start">
          <span aria-hidden="true">{letterCount}</span>
          <span className="sr-only">{letterCount === 1 ? '1 letter' : `${letterCount} letters`}</span>
        </InputGroupText>
      </InputGroup>

      <div id={hintId} className="mt-1 flex flex-col gap-0.5 text-sm text-muted empty:hidden">
        {showError && <p className="font-medium text-signal-in">{error}</p>}
        {showShortHint && <p>Short messages are hard to break; 250+ letters work best.</p>}
        {example && (
          <p>
            Example: {example.ciphertext.replace(/[^A-Za-z]/g, '').length} letters from{' '}
            <cite className="not-italic">{example.source}</cite>, enciphered with a random hidden
            key.
          </p>
        )}
      </div>
      {exampleError && (
        <p role="alert" className="mt-1 text-sm font-medium text-signal-in">
          {exampleError}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Hint content="Encipher a real passage with a random key, then try to break it">
          <Button className="min-w-0 flex-1 sm:flex-none" onClick={onExample} disabled={disabled}>
            Try an example
          </Button>
        </Hint>
        <Button
          className="min-w-0 flex-1 sm:flex-none"
          onClick={onClear}
          disabled={disabled || value === ''}
        >
          Clear
        </Button>
      </div>
    </div>
  )
}
