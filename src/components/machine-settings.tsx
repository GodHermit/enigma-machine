import { useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ALPHABET, MODELS, MODEL_ORDER, REFLECTORS, ROTORS, ringLabel } from '../lib/enigma'
import type {
  AnyRotorId,
  ModelId,
  ReflectorId,
  RotorSlot,
  SlotId,
  ValidationIssue,
} from '../lib/enigma'
import { cn } from '../lib/cn'
import { useEnigmaStore, useValidation } from '../state'
import type { RingDisplay } from '../state'
import { Field, Hint, InfoTip, SimpleSelect } from './ui'
import type { SimpleSelectOption } from './ui'

/* ------------------------------------------------------------------ */
/* Static data                                                         */
/* ------------------------------------------------------------------ */

const MAIN_SLOTS = ['left', 'middle', 'right'] as const

const SLOT_TITLES: Record<SlotId, string> = {
  greek: 'Greek',
  left: 'Left',
  middle: 'Middle',
  right: 'Right',
}

/** Accessible name of each slot ("Left rotor", "Greek wheel"). */
const SLOT_NAMES: Record<SlotId, string> = {
  greek: 'Greek wheel',
  left: 'Left rotor',
  middle: 'Middle rotor',
  right: 'Right rotor',
}

const MODEL_OPTIONS: SimpleSelectOption[] = MODEL_ORDER.map((id) => ({
  value: id,
  label: MODELS[id].name,
  description: MODELS[id].description,
  textValue: MODELS[id].name,
}))

const POSITION_OPTIONS: SimpleSelectOption[] = ALPHABET.split('').map((letter, i) => ({
  value: String(i),
  label: letter,
}))

const RING_OPTIONS: Record<RingDisplay, SimpleSelectOption[]> = {
  number: ringOptions('number'),
  letter: ringOptions('letter'),
}

function ringOptions(mode: RingDisplay): SimpleSelectOption[] {
  return Array.from({ length: 26 }, (_, i) => ({ value: String(i), label: ringLabel(i, mode) }))
}

/** "Q", "Z+M", or "" for rotors without a notch (Greek wheels). */
function turnoverLabel(rotor: AnyRotorId): string {
  const spec = ROTORS[rotor]
  return spec ? spec.notches.split('').join('+') : ''
}

/** Wide-enough dropdown whose long descriptions wrap instead of stretching the menu. */
const DESCRIBED_MENU = 'w-[max(var(--radix-select-trigger-width),16rem)]'

/**
 * Borderless select that fills its table cell, so the cell itself is the visual box
 * (hover / open → grey like the active instruction cell of the reference table).
 */
const CELL_SELECT =
  'h-10 w-full justify-center gap-1 rounded-none border-0 bg-transparent px-2 hover:bg-surface-2 data-[state=open]:bg-surface-2 aria-invalid:text-signal-in focus-visible:bg-surface-2 [&>svg]:size-3.5 [&>svg]:opacity-50'

/** Every cell: 2px right/bottom border; the wrapper draws the rounded outer frame. */
const CELL = 'border-r border-b border-border last:border-r-0'

/** Sticky first column (slot names) for narrow screens where the table scrolls. */
const STICKY_CELL = 'sticky left-0 z-[1] bg-bg'

/* ------------------------------------------------------------------ */
/* Column explanations                                                 */
/* ------------------------------------------------------------------ */

const ROTOR_INFO = (
  <>
    <p>Which wheel sits in this slot. Each rotor has its own fixed internal wiring.</p>
    <p>
      The right rotor steps on every key press; the others step when the rotor to their right
      passes its turnover notch. A rotor can only be used in one slot at a time.
    </p>
  </>
)

const RING_INFO = (
  <>
    <p>
      Ringstellung: rotates the wiring relative to the lettered ring and the notch, shifting the
      whole substitution.
    </p>
    <p>Part of the daily key; it does not change when the rotors step.</p>
  </>
)

const POSITION_INFO = (
  <>
    <p>Grundstellung: the letter shown in the rotor window before the first key press.</p>
    <p>To decrypt a message, reset to the same start positions it was encrypted with.</p>
  </>
)

/** Column header text plus its "?" popover. */
function ColumnTitle({ info, children }: { info: ReactNode; children: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {children}
      <InfoTip label={children} className="font-normal">
        {info}
      </InfoTip>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export type MachineSettingsProps = Omit<ComponentProps<'section'>, 'children'>

/**
 * Left column of the machine controls: "Model:", "Reflector:" and the "Rotors:" table
 * (one row per active slot: rotor, ring setting, start position, turnover letters).
 */
export function MachineSettings({ className, ...props }: MachineSettingsProps) {
  const { model, reflector, hasGreek } = useEnigmaStore(
    useShallow((s) => ({
      model: s.settings.model,
      reflector: s.settings.reflector,
      hasGreek: s.settings.greek !== null,
    })),
  )
  const setModel = useEnigmaStore((s) => s.setModel)
  const setReflector = useEnigmaStore((s) => s.setReflector)
  const issues = useValidation()

  const modelSpec = MODELS[model]
  const reflectorOptions = withCurrent(
    (modelSpec?.reflectorIds ?? []).map((id) => reflectorOption(id)),
    reflector,
    () => reflectorOption(reflector, true),
  )
  const slots: SlotId[] = hasGreek ? ['greek', ...MAIN_SLOTS] : [...MAIN_SLOTS]
  const slotIssues = issues.filter(
    (i) => i.field !== 'model' && i.field !== 'reflector' && i.field !== 'plugboard',
  )
  const invalidSlots = new Set(slotIssues.map((i) => i.field))

  return (
    <section
      aria-label="Machine settings"
      className={cn('flex min-w-0 flex-col gap-6', className)}
      {...props}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="Model:"
          htmlFor="machine-model"
          error={issueText(issues, 'model')}
          info={
            <>
              <p>Which Enigma variant to emulate.</p>
              <p>
                It decides which rotors and reflectors you can pick and whether a fourth (Greek)
                wheel is fitted, as on the naval M4.
              </p>
            </>
          }
        >
          <SimpleSelect
            id="machine-model"
            value={model}
            onValueChange={(v) => setModel(v as ModelId)}
            options={MODEL_OPTIONS}
            contentClassName={DESCRIBED_MENU}
            aria-invalid={hasIssue(issues, 'model') || undefined}
          />
        </Field>
        <Field
          label="Reflector:"
          htmlFor="machine-reflector"
          error={issueText(issues, 'reflector')}
          info={
            <>
              <p>
                The reflector (Umkehrwalze, UKW) sends the signal back through the rotors a second
                time.
              </p>
              <p>
                It never maps a letter to itself, which is why the same settings both encrypt and
                decrypt.
              </p>
            </>
          }
        >
          <SimpleSelect
            id="machine-reflector"
            value={reflector}
            onValueChange={(v) => setReflector(v as ReflectorId)}
            options={reflectorOptions}
            contentClassName={DESCRIBED_MENU}
            aria-invalid={hasIssue(issues, 'reflector') || undefined}
          />
        </Field>
      </div>

      <div className="flex min-w-0 flex-col">
        <span id="machine-rotors-label" className="mb-2 inline-block">
          Rotors:
        </span>
        <div className="overflow-x-auto rounded-md border border-border">
          <table
            aria-labelledby="machine-rotors-label"
            className="w-full min-w-[28rem] border-separate border-spacing-0 text-center"
          >
            <thead>
              <tr>
                <th scope="col" className={cn(CELL, STICKY_CELL, 'px-2 py-2 leading-5 font-bold')}>
                  Slot
                </th>
                <th scope="col" className={cn(CELL, 'px-2 py-2 leading-5 font-bold')}>
                  <ColumnTitle info={ROTOR_INFO}>Rotor</ColumnTitle>
                </th>
                <th scope="col" className={cn(CELL, 'px-2 py-2 leading-5 font-bold')}>
                  <ColumnTitle info={RING_INFO}>Ring setting</ColumnTitle>
                </th>
                <th scope="col" className={cn(CELL, 'px-2 py-2 leading-5 font-bold')}>
                  <ColumnTitle info={POSITION_INFO}>Start position</ColumnTitle>
                </th>
                <th scope="col" className={cn(CELL, 'px-2 py-2 leading-5 font-bold')}>
                  Turnover
                </th>
              </tr>
            </thead>
            <tbody className="[&>tr:last-child>*]:border-b-0">
              {slots.map((slot) => (
                <RotorRow key={slot} slot={slot} model={model} invalid={invalidSlots.has(slot)} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-sm text-muted">
          Turnover: window letter at which the rotor to the left is carried one step
          {hasGreek ? '. Greek wheels never step.' : '.'}
        </p>
        {slotIssues.length > 0 && (
          <ul role="alert" className="mt-1 flex flex-col text-sm font-medium text-signal-in">
            {slotIssues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

interface RotorRowProps {
  slot: SlotId
  model: ModelId
  invalid: boolean
}

function RotorRow({ slot, model, invalid }: RotorRowProps) {
  const rotorSlot = useEnigmaStore((s): RotorSlot | null =>
    slot === 'greek' ? s.settings.greek : s.settings[slot],
  )
  const mainRotors = useEnigmaStore(
    useShallow((s) => [s.settings.left.rotor, s.settings.middle.rotor, s.settings.right.rotor]),
  )
  const ringDisplay = useEnigmaStore((s) => s.options.ringDisplay)
  const setRotor = useEnigmaStore((s) => s.setRotor)
  const setRing = useEnigmaStore((s) => s.setRing)
  const setPosition = useEnigmaStore((s) => s.setPosition)
  // The rotor hint hides while the rotor dropdown is open so it never covers the list.
  const [hintOpen, setHintOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  if (!rotorSlot) return null

  const name = SLOT_NAMES[slot]
  const spec = ROTORS[rotorSlot.rotor]
  const modelSpec = MODELS[model]
  const allowed: readonly AnyRotorId[] =
    slot === 'greek' ? (modelSpec?.greekIds ?? []) : (modelSpec?.rotorIds ?? [])
  const rotorOptions = withCurrent(
    allowed.map((id) => {
      const usedIn = slot === 'greek' ? -1 : mainRotors.indexOf(id)
      const other = usedIn >= 0 ? MAIN_SLOTS[usedIn] : null
      return rotorOption(id, other && other !== slot ? other : null)
    }),
    rotorSlot.rotor,
    () => ({
      ...rotorOption(rotorSlot.rotor, null),
      disabled: true,
      description: `Not available on the ${modelSpec?.name ?? 'model'}`,
    }),
  )
  const turnover = turnoverLabel(rotorSlot.rotor)

  const hint: ReactNode = spec ? (
    <span className="flex flex-col gap-0.5 text-left">
      <span className="font-bold">
        {spec.kind === 'greek' ? `Greek wheel ${spec.id}` : `Rotor ${spec.id}`}
      </span>
      <span>{spec.description}</span>
      <span>
        Wiring: <span className="font-mono text-xs">{spec.wiring}</span>
      </span>
      <span>
        {spec.kind === 'greek'
          ? 'No notch, never steps.'
          : `Notch${spec.notches.length > 1 ? 'es' : ''}: ${turnover}`}
      </span>
    </span>
  ) : null

  return (
    <tr>
      <th
        scope="row"
        className={cn(CELL, STICKY_CELL, 'px-2 py-2 leading-6 font-bold whitespace-nowrap')}
      >
        {SLOT_TITLES[slot]}
      </th>
      <Hint
        content={hint}
        side="top"
        className="max-w-[18rem]"
        open={hintOpen && !menuOpen}
        onOpenChange={setHintOpen}
      >
        <td className={cn(CELL, 'p-0')}>
          <SimpleSelect
            aria-label={name}
            value={rotorSlot.rotor}
            onValueChange={(v) => setRotor(slot, v as AnyRotorId)}
            open={menuOpen}
            onOpenChange={(open) => {
              setMenuOpen(open)
              if (open) setHintOpen(false)
            }}
            options={rotorOptions}
            className={CELL_SELECT}
            aria-invalid={invalid || undefined}
          />
        </td>
      </Hint>
      <td className={cn(CELL, 'p-0')}>
        <SimpleSelect
          aria-label={`${name} ring setting`}
          value={String(rotorSlot.ring)}
          onValueChange={(v) => setRing(slot, Number(v))}
          options={RING_OPTIONS[ringDisplay]}
          className={CELL_SELECT}
        />
      </td>
      <td className={cn(CELL, 'p-0')}>
        <SimpleSelect
          aria-label={`${name} start position`}
          value={String(rotorSlot.position)}
          onValueChange={(v) => setPosition(slot, Number(v))}
          options={POSITION_OPTIONS}
          className={CELL_SELECT}
        />
      </td>
      <td className={cn(CELL, 'px-2 py-2 leading-6 font-medium')}>
        {turnover ? (
          <span aria-label={`Turnover at ${turnover.split('+').join(' and ')}`}>{turnover}</span>
        ) : (
          <span aria-label="No turnover" className="text-muted">
            —
          </span>
        )}
      </td>
    </tr>
  )
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function rotorOption(id: AnyRotorId, swapWith: SlotId | null): SimpleSelectOption {
  const notches = turnoverLabel(id)
  const base = notches ? `Turnover ${notches}` : 'Never steps'
  return {
    value: id,
    label: id,
    textValue: id,
    description: swapWith ? `${base} · swaps with ${SLOT_TITLES[swapWith].toLowerCase()}` : base,
  }
}

function reflectorOption(id: ReflectorId, notAllowed = false): SimpleSelectOption {
  const spec = REFLECTORS[id]
  return {
    value: id,
    label: spec?.name ?? id,
    textValue: spec?.name ?? id,
    description: notAllowed ? 'Not available on this model' : spec?.description,
    disabled: notAllowed,
  }
}

/** Keeps the current (possibly invalid) value listed so the trigger can still display it. */
function withCurrent(
  options: SimpleSelectOption[],
  current: string,
  make: () => SimpleSelectOption,
): SimpleSelectOption[] {
  return options.some((o) => o.value === current) ? options : [...options, make()]
}

function hasIssue(issues: ValidationIssue[], field: ValidationIssue['field']): boolean {
  return issues.some((i) => i.field === field)
}

function issueText(issues: ValidationIssue[], field: ValidationIssue['field']): ReactNode {
  const messages = issues.filter((i) => i.field === field).map((i) => i.message)
  return messages.length > 0 ? messages.join(' ') : undefined
}
