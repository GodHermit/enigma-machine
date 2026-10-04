import { useId, useRef, useState } from 'react'
import type { ComponentProps, FormEvent, ReactNode } from 'react'
import {
  CheckIcon,
  CircleXIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  LinkIcon,
  RotateCcwIcon,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { HISTORICAL_PLUGS, MODELS, REFLECTORS, decodeSettings, encodeSettings } from '../lib/enigma'
import type { MachineSettings } from '../lib/enigma'
import { readHashSettings, shareUrl, useEnigmaStore } from '../state'
import type { RingDisplay } from '../state'
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Hint,
  InfoTip,
  Input,
} from './ui'
import { useCopyFeedback } from './use-copy-feedback'
import type { CopyStatus } from './use-copy-feedback'

/** Accepts a bare key (`I.UKW-B.I-II-III.AAA.AAA.`) or a share link containing `#key=…`. */
function parseKeyOrLink(text: string): MachineSettings | null {
  const value = text.trim()
  if (value === '') return null
  const hashIndex = value.indexOf('#')
  if (hashIndex !== -1) return readHashSettings(value.slice(hashIndex))
  if (value.startsWith('key=')) return readHashSettings(value)
  return decodeSettings(value)
}

/** One-line human description of a key, e.g. "Enigma I · UKW-B · I II III · 10 plugs". */
function describeSettings(s: MachineSettings): string {
  const rotors = [s.greek, s.left, s.middle, s.right]
    .flatMap((slot) => (slot ? [slot.rotor] : []))
    .join(' ')
  const plugs = s.plugboard.length === 1 ? '1 plug' : `${s.plugboard.length} plugs`
  return [MODELS[s.model].name, REFLECTORS[s.reflector].name, rotors, plugs].join(' · ')
}

function copyStatusIcon(status: CopyStatus, idle: ReactNode) {
  if (status === 'copied') return <CheckIcon />
  if (status === 'failed') return <CircleXIcon />
  return idle
}

function copyStatusLabel(status: CopyStatus, idle: string): string {
  if (status === 'copied') return 'Copied!'
  if (status === 'failed') return 'Copy failed'
  return idle
}

function isRingDisplay(value: string): value is RingDisplay {
  return value === 'number' || value === 'letter'
}

export interface ImportKeyDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** Where focus goes when the dialog closes (defaults to Radix' behaviour). */
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>['onCloseAutoFocus']
}

/** "Import key…" modal: paste a key or share link, validated as you type. */
export function ImportKeyDialog({ open, onOpenChange, onCloseAutoFocus }: ImportKeyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Import key"
        description="Paste a key copied with “Copy key”, or a share link."
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <ImportKeyForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function ImportKeyForm({ onDone }: { onDone(): void }) {
  const id = useId()
  const [text, setText] = useState('')
  const loadSettings = useEnigmaStore((s) => s.loadSettings)
  const clearInput = useEnigmaStore((s) => s.clearInput)

  const parsed = parseKeyOrLink(text)
  const empty = text.trim() === ''
  const error = !empty && parsed === null ? 'This is not a valid key or share link.' : undefined
  const hint = parsed ? describeSettings(parsed) : 'Example: I.UKW-B.I-II-III.AAA.AAA.AB-CD'

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!parsed) return
    loadSettings(parsed)
    clearInput()
    onDone()
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogBody>
        <Field
          label="Key:"
          htmlFor={id}
          hint={hint}
          error={error}
          info="A key encodes model, reflector, rotors, ring settings, start positions and plugboard. Paste one copied with “Copy key”, or a whole share link."
        >
          <Input
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={error != null}
            placeholder="M3.UKW-B.II-IV-V.BUL.ABC.AV-BS-CG"
            className="font-mono"
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="primary" disabled={!parsed}>
          Import
        </Button>
      </DialogFooter>
    </form>
  )
}

export type MachineControlsProps = ComponentProps<'div'>

/**
 * The "Machine:" block: Reset · Continue from here · Randomize · ⋮ (share, key import/export,
 * ring display, reset settings). Buttons stack full-width below `sm` with ⋮ beside the
 * last one, like the reference "Run | Make step | Reset | ⋮" row.
 */
export function MachineControls({ className, ...props }: MachineControlsProps) {
  const labelId = useId()
  const inputEmpty = useEnigmaStore((s) => s.input.length === 0)
  const ringDisplay = useEnigmaStore((s) => s.options.ringDisplay)
  const clearInput = useEnigmaStore((s) => s.clearInput)
  const adoptCurrentPositions = useEnigmaStore((s) => s.adoptCurrentPositions)
  const randomize = useEnigmaStore((s) => s.randomize)
  const resetSettings = useEnigmaStore((s) => s.resetSettings)
  const setOption = useEnigmaStore((s) => s.setOption)

  const linkCopy = useCopyFeedback()
  const keyCopy = useCopyFeedback()
  const [announcement, setAnnouncement] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const openingDialog = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const copyShareLink = async () => {
    const ok = await linkCopy.copy(shareUrl(useEnigmaStore.getState().settings))
    setAnnouncement(ok ? 'Share link copied to the clipboard.' : 'Could not copy the share link.')
  }

  const copyKey = async () => {
    const ok = await keyCopy.copy(encodeSettings(useEnigmaStore.getState().settings))
    setAnnouncement(ok ? 'Key copied to the clipboard.' : 'Could not copy the key.')
  }

  return (
    <div className={cn('min-w-0', className)} {...props}>
      <div className="mb-2 flex items-center gap-1">
        <span id={labelId} className="select-none">
          Machine:
        </span>
        <InfoTip label="Machine actions" contentClassName="w-96 max-w-[min(24rem,var(--radix-popover-content-available-width))]">
          <dl>
            <dt>Reset</dt>
            <dd>Clears the text. The rotors go back to their start position.</dd>
            <dt>Continue from here</dt>
            <dd>
              Keeps the rotors where the typed text left them: their current letters become the new
              start position and the text is cleared.
            </dd>
            <dt>Randomize</dt>
            <dd>
              Picks random rotors, ring settings, start positions and {HISTORICAL_PLUGS} plug cables
              for the current model, and clears the text.
            </dd>
            <dt>⋮ Copy share link / Copy key</dt>
            <dd>
              Copies the full machine setup: as a link that opens this page with it, or as a
              compact key string.
            </dd>
            <dt>⋮ Import key…</dt>
            <dd>Loads a setup from a pasted key or share link.</dd>
            <dt>⋮ Ring settings</dt>
            <dd>Shows ring settings as numbers (01–26) or letters (A–Z). Display only.</dd>
            <dt>⋮ Reset settings to defaults</dt>
            <dd>Restores the model's factory setup and clears the text.</dd>
          </dl>
        </InfoTip>
      </div>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
      >
        <Hint content="Clear the text and turn the rotors back to their start position">
          <Button
            variant="primary"
            className="w-full sm:w-auto sm:min-w-fit sm:flex-1"
            disabled={inputEmpty}
            onClick={clearInput}
          >
            Reset
          </Button>
        </Hint>
        <Hint content="Make the current rotor positions the new start position and clear the text">
          <Button
            className="w-full sm:w-auto sm:min-w-fit sm:flex-1"
            disabled={inputEmpty}
            onClick={adoptCurrentPositions}
          >
            Continue from here
          </Button>
        </Hint>
        <div className="flex gap-2 sm:contents">
          <Hint content="Random rotors, rings, positions and 10 plug cables">
            <Button className="min-w-0 flex-1 sm:min-w-fit" onClick={randomize}>
              Randomize
            </Button>
          </Hint>
          <DropdownMenu
            onOpenChange={(open) => {
              if (open) {
                linkCopy.reset()
                keyCopy.reset()
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button ref={triggerRef} size="icon" aria-label="More machine actions">
                <EllipsisVerticalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-64 max-w-[calc(100vw-2rem)]"
              onCloseAutoFocus={(event) => {
                // Let the import dialog take focus instead of the ⋮ trigger.
                if (openingDialog.current) {
                  openingDialog.current = false
                  event.preventDefault()
                }
              }}
            >
              <DropdownMenuItem
                icon={copyStatusIcon(linkCopy.status, <LinkIcon />)}
                onSelect={(event) => {
                  event.preventDefault()
                  void copyShareLink()
                }}
              >
                {copyStatusLabel(linkCopy.status, 'Copy share link')}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={copyStatusIcon(keyCopy.status, <CopyIcon />)}
                onSelect={(event) => {
                  event.preventDefault()
                  void copyKey()
                }}
              >
                {copyStatusLabel(keyCopy.status, 'Copy key')}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<DownloadIcon />}
                onSelect={() => {
                  openingDialog.current = true
                  setImportOpen(true)
                }}
              >
                Import key…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel inset>Ring settings</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={ringDisplay}
                onValueChange={(value) => {
                  if (isRingDisplay(value)) setOption('ringDisplay', value)
                }}
              >
                <DropdownMenuRadioItem value="number">Numbers (01–26)</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="letter">Letters (A–Z)</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon={<RotateCcwIcon />}
                onSelect={() => {
                  resetSettings()
                  clearInput()
                }}
              >
                Reset settings to defaults
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      <ImportKeyDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
      />
    </div>
  )
}
