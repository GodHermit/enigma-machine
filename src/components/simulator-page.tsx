import { Lampboard } from './lampboard'
import { MachineControls } from './machine-controls'
import { MachineSettings } from './machine-settings'
import { Plugboard } from './plugboard'
import { RotorWindows } from './rotor-windows'
import { SignalPath } from './signal-path'
import { TextIO } from './text-io'

/** The simulator tab: rotor windows, settings, plugboard, lampboard, text and signal path. */
export function SimulatorPage() {
  return (
    <>
      <RotorWindows className="py-6" />

      {/* Like the reference: the "Machine:" column comes first on small screens. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <MachineSettings className="order-2 lg:order-1" />
        <div className="order-1 flex min-w-0 flex-col gap-6 lg:order-2">
          <MachineControls />
          <Plugboard />
        </div>
      </div>

      <Lampboard className="mt-12" />
      <TextIO className="mt-12" />
      <SignalPath className="mt-12" />
    </>
  )
}
