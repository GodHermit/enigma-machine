import { useMemo, useState } from 'react'
import { MODELS } from '../../lib/enigma'
import type { ModelId } from '../../lib/enigma'
import { sampleChallenge } from '../../lib/breaker'
import type { SampleChallenge } from '../../lib/breaker/types'
import { BreakerActions } from './breaker-actions'
import { BreakerProgress } from './breaker-progress'
import { BreakerResults } from './breaker-results'
import { BreakerSettings } from './breaker-settings'
import { CiphertextPanel } from './ciphertext-panel'
import { defaultForm, formToConfig, hasIssues, validateForm, withModel } from './form-state'
import { HowItWorks } from './how-it-works'
import { SearchSpace } from './search-space'
import { letters } from './safe-engine'
import { useBreaker, usePersistentForm } from './use-breaker'
import { cpuOnlyEstimate, processorEstimate, processorPlan } from './processors'
import { useGpuInfo } from './use-gpu-info'

/** The Codebreaker tab: ciphertext → search settings → run → ranked keys. */
export default function BreakerPage() {
  const [form, setForm] = usePersistentForm()
  const breaker = useBreaker()
  const { snapshot, running } = breaker
  const [example, setExample] = useState<SampleChallenge | null>(null)
  const [exampleError, setExampleError] = useState<string | null>(null)

  const letterCount = useMemo(() => letters(form.ciphertext).length, [form.ciphertext])
  const issues = useMemo(() => validateForm(form), [form])
  const config = useMemo(() => formToConfig(form), [form])
  const gpu = useGpuInfo()
  const processors = useMemo(() => processorPlan(config, gpu), [config, gpu])
  const estimate = useMemo(() => processorEstimate(config, processors), [config, processors])
  const cpuEstimate = useMemo(() => (processors.gpu ? cpuOnlyEstimate(config, processors) : null), [config, processors])
  const canStart = !hasIssues(issues)
  const blockedReason =
    issues.ciphertext ?? issues.rotors ?? issues.reflectors ?? issues.greekRotors ?? issues.crib ?? null

  const tryExample = () => {
    try {
      const sample = sampleChallenge({ model: form.model, language: form.language })
      setExample(sample)
      setExampleError(null)
      setForm((f) => ({ ...f, ciphertext: sample.ciphertext }))
    } catch (error) {
      setExampleError(
        `Could not make an example: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const changeModel = (model: ModelId) => setForm((f) => withModel(f, model))
  const resetForm = () => setForm((f) => ({ ...defaultForm(f.model), ciphertext: f.ciphertext }))

  // The example only counts while its ciphertext is what was (or is being) broken.
  const runCiphertext = snapshot.config?.ciphertext ?? form.ciphertext
  const activeExample = example && example.ciphertext === form.ciphertext ? example : null
  const runExample = example && example.ciphertext === runCiphertext ? example : null
  const phase = snapshot.progress.phase
  const finished = phase === 'done' || phase === 'cancelled'

  return (
    <section aria-label="Codebreaker" className="pb-6">
      <p className="mx-auto mt-6 max-w-2xl text-center text-muted">
        Recovers the full key (rotors, rings, start positions and plugboard) from the ciphertext
        alone, the way codebreakers did at Bletchley Park, but with your own graphics card (WebGPU) and CPU cores — nothing leaves your device.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <CiphertextPanel
          className="order-1"
          value={form.ciphertext}
          letterCount={letterCount}
          onChange={(ciphertext) => setForm((f) => ({ ...f, ciphertext }))}
          onExample={tryExample}
          onClear={() => setForm((f) => ({ ...f, ciphertext: '' }))}
          example={activeExample}
          exampleError={exampleError}
          error={issues.ciphertext}
          disabled={running}
        />

        <div className="order-3 flex min-w-0 flex-col gap-6 lg:order-2">
          <BreakerActions
            canStart={canStart}
            running={running}
            blockedReason={blockedReason}
            estimate={estimate}
            cpuEstimate={cpuEstimate}
            processors={processors}
            hasGreek={MODELS[form.model].hasGreek}
            onStart={() => breaker.start(config)}
            onStop={breaker.cancel}
            onResetForm={resetForm}
          />
          {breaker.startError && (
            <p role="alert" className="-mt-4 text-sm font-medium text-signal-in">
              Could not start the codebreaker: {breaker.startError}
            </p>
          )}
          {phase !== 'idle' && <BreakerProgress snapshot={snapshot} />}
        </div>

        <BreakerSettings
          className="order-2 lg:order-3 lg:col-span-2"
          form={form}
          issues={issues}
          onChange={setForm}
          onModelChange={changeModel}
          gpu={gpu}
          disabled={running}
        />

        <SearchSpace
          className="order-2 lg:order-4 lg:col-span-2"
          config={config}
          estimate={estimate}
          processors={processors.label}
        />
      </div>

      {snapshot.candidates.length > 0 ? (
        <BreakerResults
          className="mt-12"
          candidates={snapshot.candidates}
          ciphertext={runCiphertext}
          example={runExample}
          finished={finished}
          language={snapshot.config?.language ?? form.language}
        />
      ) : (
        phase === 'done' && (
          <p className="mt-12 text-center text-muted">
            No candidate key was found. Try a longer message, more rotors or reflectors, or a crib.
          </p>
        )
      )}

      <HowItWorks className="mt-12" />
    </section>
  )
}
