import { useId } from 'react'
import type { ReactNode } from 'react'
import { CheckIcon } from 'lucide-react'
import { MODELS, MODEL_ORDER, REFLECTORS } from '../../lib/enigma'
import type { GreekRotorId, ModelId, ReflectorId, RotorId } from '../../lib/enigma'
import type { BreakerLanguage, RingSearch } from '../../lib/breaker/types'
import { cn } from '../../lib/cn'
import {
  Field,
  Input,
  InputGroup,
  InputGroupText,
  SimpleSelect,
  Slider,
  ToggleGroup,
  ToggleGroupItem,
} from '../ui'
import type { SimpleSelectOption } from '../ui'
import { MAX_CABLES, MAX_TYPO_TOLERANCE, maxWorkers } from './form-state'
import type { BreakerForm, FormIssues } from './form-state'
import { processorPlan } from './processors'
import type { GpuInfo } from './use-gpu-info'
import { wasmSimdAvailable } from './wasm-support'

const MODEL_OPTIONS: SimpleSelectOption[] = MODEL_ORDER.map((id) => ({
  value: id,
  label: MODELS[id].name,
  description: MODELS[id].description,
  textValue: MODELS[id].name,
}))

const LANGUAGE_OPTIONS: SimpleSelectOption[] = [
  { value: 'de', label: 'German' },
  { value: 'en', label: 'English' },
]

const RING_OPTIONS: SimpleSelectOption[] = [
  {
    value: 'right-middle',
    label: 'Search right + middle rings (recommended)',
    textValue: 'Search right + middle rings',
    description: '676 ring combinations per survivor',
  },
  {
    value: 'right',
    label: 'Search right ring only',
    textValue: 'Search right ring only',
    description: 'Faster; fine for short messages',
  },
  {
    value: 'none',
    label: 'Assume AAA',
    textValue: 'Assume AAA',
    description: 'Fastest; only if the rings are known to be 01 01 01',
  },
]

const WIDE_MENU = 'w-[max(var(--radix-select-trigger-width),18rem)]'

/**
 * Multi-select chips: separate (not a joined segmented control) and stretched to fill the row,
 * so eight of them still fit a 360px screen. Selected chips are grey with a check rather than
 * solid black, so a fully selected row does not turn into a wall of black blocks; keyboard
 * focus still turns the border black.
 */
const CHIPS = 'w-full gap-1.5'
const CHIP = cn(
  'group min-w-0 flex-1 gap-1 px-1 ml-0! rounded-md! text-muted',
  'data-[state=on]:z-auto! data-[state=on]:border-border-strong! data-[state=on]:bg-surface-2! data-[state=on]:font-bold data-[state=on]:text-fg! data-[state=on]:hover:bg-surface-2!',
  'data-[state=on]:focus-visible:border-fg-emphasis!',
)

function Chip({ value, label, children }: { value: string; label?: string; children: ReactNode }) {
  return (
    <ToggleGroupItem value={value} aria-label={label} className={CHIP}>
      <CheckIcon
        aria-hidden
        strokeWidth={3}
        className="hidden size-3.5 sm:group-data-[state=on]:inline"
      />
      {children}
    </ToggleGroupItem>
  )
}

const GREEK_NAMES: Record<GreekRotorId, string> = { Beta: 'β Beta', Gamma: 'γ Gamma' }

export interface BreakerSettingsProps {
  form: BreakerForm
  issues: FormIssues
  onChange(update: (form: BreakerForm) => BreakerForm): void
  onModelChange(model: ModelId): void
  /** The device's GPU (WebGPU), for the Processor option. */
  gpu: GpuInfo
  disabled?: boolean
  className?: string
}

/** Search space and options: model, language, reflectors, rotors, rings, plugs, crib, workers. */
export function BreakerSettings({
  form,
  issues,
  onChange,
  onModelChange,
  gpu,
  disabled,
  className,
}: BreakerSettingsProps) {
  const id = useId()
  const spec = MODELS[form.model]
  const workerMax = maxWorkers()
  const plan = processorPlan(form, gpu)
  const processorOptions: SimpleSelectOption[] = [
    {
      value: 'auto',
      label: gpu.state === 'ready' ? `GPU + CPU (recommended)` : 'GPU + CPU when a GPU is available',
      description:
        gpu.state === 'ready'
          ? `Your ${gpu.name} runs the rotor search with WebGPU, beside the CPU workers.`
          : 'This browser exposes no WebGPU graphics card, so the CPU does all the work.',
    },
    { value: 'cpu', label: 'CPU only', description: 'Leave the graphics card idle (same results, slower).' },
  ]
  const simd = wasmSimdAvailable()
  const engineOptions: SimpleSelectOption[] = [
    {
      value: 'wasm',
      label: simd ? 'WebAssembly SIMD (recommended)' : 'WebAssembly SIMD (not supported here)',
      description: simd
        ? 'The CPU workers run the search compiled to WebAssembly, using 128-bit SIMD instructions.'
        : 'This browser cannot run WebAssembly SIMD, so the JavaScript engine is used instead.',
    },
    {
      value: 'js',
      label: 'JavaScript (reference)',
      description: 'The original JavaScript implementation — same results, useful for comparison.',
    },
  ]
  const set = <K extends keyof BreakerForm>(key: K, value: BreakerForm[K]) =>
    onChange((f) => ({ ...f, [key]: value }))

  return (
    <section
      aria-label="Codebreaker settings"
      className={cn('grid min-w-0 gap-6 lg:grid-cols-2', className)}
    >
      <div className="flex min-w-0 flex-col gap-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            label="Model:"
            htmlFor={`${id}-model`}
            info={
              <>
                <p>Which Enigma produced the message.</p>
                <p>
                  It decides the rotors and reflectors that can be tried, and whether a fourth
                  (Greek) wheel has to be searched as on the naval M4.
                </p>
              </>
            }
          >
            <SimpleSelect
              id={`${id}-model`}
              value={form.model}
              onValueChange={(v) => onModelChange(v as ModelId)}
              options={MODEL_OPTIONS}
              contentClassName={WIDE_MENU}
              disabled={disabled}
            />
          </Field>
          <Field
            label="Plaintext language:"
            htmlFor={`${id}-language`}
            info="The language the message is expected to be in. The final steps score decrypts with letter statistics (n-grams) of this language."
          >
            <SimpleSelect
              id={`${id}-language`}
              value={form.language}
              onValueChange={(v) => set('language', v as BreakerLanguage)}
              options={LANGUAGE_OPTIONS}
              disabled={disabled}
            />
          </Field>
        </div>

        <Field
          label="Reflectors:"
          error={issues.reflectors}
          info="Reflectors that may have been fitted. Each extra one doubles the work, so leave out those you can rule out (UKW-B was standard from 1937)."
        >
          <ToggleGroup
            type="multiple"
            aria-label="Reflectors"
            value={form.reflectors}
            onValueChange={(v) => set('reflectors', spec.reflectorIds.filter((r) => v.includes(r)))}
            disabled={disabled}
            className={CHIPS}
          >
            {spec.reflectorIds.map((r: ReflectorId) => (
              <Chip key={r} value={r}>
                {REFLECTORS[r].name}
              </Chip>
            ))}
          </ToggleGroup>
        </Field>

        <Field
          label="Rotors to try:"
          error={issues.rotors}
          info={
            <>
              <p>
                Rotors that may be in the machine. Every ordered choice of three of them is tried:
                60 orders for five rotors, 336 for eight.
              </p>
              <p>Narrow this down if you know which rotors were in use.</p>
            </>
          }
        >
          <ToggleGroup
            type="multiple"
            aria-label="Rotors to try"
            value={form.rotors}
            onValueChange={(v) => set('rotors', spec.rotorIds.filter((r) => v.includes(r)))}
            disabled={disabled}
            className={CHIPS}
          >
            {spec.rotorIds.map((r: RotorId) => (
              <Chip key={r} value={r} label={`Rotor ${r}`}>
                {r}
              </Chip>
            ))}
          </ToggleGroup>
        </Field>

        {spec.hasGreek && (
          <Field
            label="Greek wheels:"
            error={issues.greekRotors}
            info="The M4's fourth, non-stepping wheel. Each wheel adds 26 positions to every rotor setting, so searching both takes 52 times longer than a three-rotor Enigma."
          >
            <ToggleGroup
              type="multiple"
              aria-label="Greek wheels"
              value={form.greekRotors}
              onValueChange={(v) =>
                set('greekRotors', spec.greekIds.filter((g) => v.includes(g)))
              }
              disabled={disabled}
              className={CHIPS}
            >
              {spec.greekIds.map((g) => (
                <Chip key={g} value={g}>
                  {GREEK_NAMES[g]}
                </Chip>
              ))}
            </ToggleGroup>
          </Field>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <Field
          label="Ring settings:"
          htmlFor={`${id}-rings`}
          info="Ring settings mostly just shift the start position; they matter only where a rotor carries its neighbour. The left ring never matters, so searching the right and middle rings finds the full key."
        >
          <SimpleSelect
            id={`${id}-rings`}
            value={form.ringSearch}
            onValueChange={(v) => set('ringSearch', v as RingSearch)}
            options={RING_OPTIONS}
            valueLabel={RING_OPTIONS.find((o) => o.value === form.ringSearch)?.label}
            contentClassName={WIDE_MENU}
            disabled={disabled}
          />
        </Field>

        <Field
          label="Plugboard cables:"
          labelAside={
            <span className="font-semibold text-fg tabular-nums">
              {form.maxPlugs === 0 ? 'none' : `${form.exactPlugs ? 'exactly' : 'up to'} ${form.maxPlugs}`}
            </span>
          }
          info={
            <>
              <p>
                How many cables the plugboard search places. Ten was the wartime rule; set 0 for a
                machine without plugboard.
              </p>
              <p>
                <strong>Exactly</strong> tells the search the precise count: it fills the plugboard
                to that number and then only rewires cables, never removing one. That makes the
                plugboard steps a little faster and avoids keys with a cable too few. Use{' '}
                <strong>Up to</strong> when you are not sure.
              </p>
            </>
          }
        >
          <div className="flex items-center gap-3">
            <ToggleGroup
              type="single"
              aria-label="Cable count"
              value={form.exactPlugs ? 'exact' : 'max'}
              onValueChange={(v) => {
                if (v) set('exactPlugs', v === 'exact')
              }}
              disabled={disabled || form.maxPlugs === 0}
              className="shrink-0"
            >
              <ToggleGroupItem value="max" size="sm">
                Up to
              </ToggleGroupItem>
              <ToggleGroupItem value="exact" size="sm">
                Exactly
              </ToggleGroupItem>
            </ToggleGroup>
            <Slider
              aria-label="Plugboard cables"
              min={0}
              max={MAX_CABLES}
              step={1}
              value={[form.maxPlugs]}
              onValueChange={([v]) => set('maxPlugs', v)}
              disabled={disabled}
              className="h-10 min-w-0 flex-1"
            />
          </div>
        </Field>

        <Field
          label="Typo tolerance:"
          labelAside={
            <span className="font-semibold text-fg tabular-nums">
              {form.typoTolerance === 0 ? 'exact words' : `${Math.round(form.typoTolerance * 100)}%`}
            </span>
          }
          info={
            <>
              <p>
                The last step checks whether the decrypt splits into dictionary words. This is how
                many letters of a word may be wrong and it still counts — a nearly right plugboard
                garbles a few letters.
              </p>
              <p>At 20%, a 5–9 letter word may have one wrong letter and a 10+ letter word two.</p>
            </>
          }
        >
          <Slider
            aria-label="Typo tolerance"
            min={0}
            max={Math.round(MAX_TYPO_TOLERANCE * 100)}
            step={2}
            value={[Math.round(form.typoTolerance * 100)]}
            onValueChange={([v]) => set('typoTolerance', v / 100)}
            disabled={disabled}
            className="h-10"
          />
        </Field>

        <Field
          label="Crib (optional):"
          htmlFor={`${id}-crib`}
          error={issues.crib}
          info={
            <>
              <p>
                A word you expect in the message, like WETTERBERICHT (weather report). It helps to
                rank candidates.
              </p>
              <p>
                Position is the letter number where it starts (1 = first letter); leave it blank to
                try everywhere it fits.
              </p>
            </>
          }
        >
          <InputGroup>
            <Input
              id={`${id}-crib`}
              value={form.cribText}
              onChange={(e) => set('cribText', e.target.value)}
              placeholder="e.g. WETTERBERICHT"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={issues.crib != null || undefined}
              disabled={disabled}
            />
            <InputGroupText aria-hidden="true">at</InputGroupText>
            <Input
              aria-label="Crib position (letter number, blank = anywhere)"
              value={form.cribPosition}
              onChange={(e) => set('cribPosition', e.target.value)}
              placeholder="anywhere"
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={issues.crib != null || undefined}
              disabled={disabled}
              className="w-28 flex-none!"
            />
          </InputGroup>
        </Field>

        <Field
          label="Processor:"
          htmlFor={`${id}-backend`}
          labelAside={
            <span className={cn('font-semibold tabular-nums', gpu.state === 'ready' ? 'text-fg' : 'text-muted')}>
              {gpu.state === 'checking' ? 'looking for a GPU…' : gpu.state === 'ready' ? `GPU found: ${gpu.name}` : 'no GPU found'}
            </span>
          }
          info={
            <>
              <p>
                With a graphics card the most expensive step — testing every rotor order and start
                position — runs as WebGPU compute shaders on your GPU, while the CPU workers take a
                share of the same work. On an Apple M3 Pro the GPU does about 14 CPU cores&apos; worth.
              </p>
              <p>
                The GPU computes exactly the same candidates and scores as the CPU (bit-identical), so
                the result never depends on this choice — only the speed. Everything runs on your
                device; nothing is uploaded.
              </p>
            </>
          }
        >
          <SimpleSelect
            id={`${id}-backend`}
            value={form.backend}
            onValueChange={(v) => set('backend', v === 'cpu' ? 'cpu' : 'auto')}
            options={processorOptions}
            contentClassName={WIDE_MENU}
            disabled={disabled}
          />
        </Field>

        <Field
          label="CPU engine:"
          htmlFor={`${id}-engine`}
          labelAside={
            <span className={cn('font-semibold', simd ? 'text-fg' : 'text-muted')}>
              {form.cpuEngine === 'wasm' && simd ? 'WebAssembly SIMD' : 'JavaScript'}
            </span>
          }
          info={
            <>
              <p>
                How the CPU workers run the rotor search. <strong>WebAssembly SIMD</strong> compiles
                the hot loops ahead of time and processes several numbers per instruction, so each
                worker is faster. <strong>JavaScript</strong> is the reference implementation.
              </p>
              <p>Both produce exactly the same candidates and scores; only the speed differs.</p>
            </>
          }
        >
          <SimpleSelect
            id={`${id}-engine`}
            value={form.cpuEngine}
            onValueChange={(v) => set('cpuEngine', v === 'js' ? 'js' : 'wasm')}
            options={engineOptions}
            contentClassName={WIDE_MENU}
            disabled={disabled}
          />
        </Field>

        <Field
          label="CPU workers:"
          labelAside={
            <span className="font-semibold text-fg tabular-nums">
              {plan.gpu ? `GPU + ${plan.cpuWorkers} CPU` : `${form.workers} of ${workerMax}`}
              <span className="font-normal text-muted"> · 1 kept free</span>
            </span>
          }
          info={
            plan.gpu
              ? 'How many CPU threads work in parallel (Web Workers). With the GPU on, one of them drives the graphics card and the rest search on the CPU. One thread is always kept free, so the page stays responsive.'
              : 'How many CPU threads search in parallel (Web Workers). More is faster. One thread is always kept free, so the page stays responsive while the search runs.'
          }
        >
          <Slider
            aria-label="CPU workers"
            min={1}
            max={workerMax}
            step={1}
            value={[Math.min(form.workers, workerMax)]}
            onValueChange={([v]) => set('workers', v)}
            disabled={disabled || workerMax <= 1}
            className="h-10"
          />
        </Field>
      </div>
    </section>
  )
}
