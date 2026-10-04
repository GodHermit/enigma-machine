import { Suspense, lazy, useEffect } from 'react'
import { AppTabs } from './components/app-tabs'
import { PageFooter } from './components/page-footer'
import { PageHeader } from './components/page-header'
import { SimulatorPage } from './components/simulator-page'
import { TooltipProvider } from './components/ui'
import { usePhysicalKeyboard } from './components/use-physical-keyboard'
import { useRoute } from './lib/hash-route'

/** The codebreaker (and its n-gram data / workers) only loads when its tab is opened. */
const BreakerPage = lazy(() => import('./components/breaker'))

/** Bootstrap `.container`: 540/720/960/1140/1320px at 576/768/992/1200/1400px. */
const container =
  'mx-auto w-full px-3 min-[576px]:max-w-[540px] min-[768px]:max-w-[720px] min-[992px]:max-w-[960px] min-[1200px]:max-w-[1140px] min-[1400px]:max-w-[1320px]'

const TITLES = { simulator: 'Enigma Machine — Simulator', breaker: 'Enigma Machine — Codebreaker' }

export default function App() {
  const route = useRoute()
  // Letters on the computer keyboard press Enigma keys (simulator only); Backspace undoes the last one.
  usePhysicalKeyboard({ enabled: route === 'simulator' })

  useEffect(() => {
    document.title = TITLES[route]
  }, [route])

  return (
    <TooltipProvider delayDuration={300}>
      <div className={`${container} pt-12`}>
        <PageHeader />
        <main>
          <AppTabs
            route={route}
            panels={{
              simulator: <SimulatorPage />,
              breaker: (
                <Suspense
                  fallback={<p className="py-12 text-center text-muted">Loading the codebreaker…</p>}
                >
                  <BreakerPage />
                </Suspense>
              ),
            }}
          />
        </main>
        <PageFooter />
      </div>
    </TooltipProvider>
  )
}
