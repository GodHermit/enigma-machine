import type { ReactNode } from 'react'
import { Tabs } from 'radix-ui'
import { cn } from '../lib/cn'
import { buildHash, navigate } from '../lib/hash-route'
import type { Route } from '../lib/hash-route'
import { buttonVariants } from './ui'
import { joinedChildren } from './ui/styles'

const TABS: { route: Route; label: string }[] = [
  { route: 'simulator', label: 'Simulator' },
  { route: 'breaker', label: 'Codebreaker' },
]

export interface AppTabsProps {
  route: Route
  /** One panel per route; only the active one is rendered. */
  panels: Record<Route, ReactNode>
}

/**
 * Top-level tabs. Each tab is a real link (`#/simulator`, `#/breaker`), so it can be
 * opened in a new tab or shared; the active one looks like the reference's primary button.
 */
export function AppTabs({ route, panels }: AppTabsProps) {
  return (
    <Tabs.Root value={route} onValueChange={(value) => navigate(value as Route)} activationMode="manual">
      <Tabs.List aria-label="Mode" className={cn('mx-auto mt-2 flex w-fit', joinedChildren)}>
        {TABS.map((tab) => (
          <Tabs.Trigger key={tab.route} value={tab.route} asChild>
            <a
              href={buildHash(tab.route)}
              className={buttonVariants({
                variant: 'outline',
                // The joined tabs overlap by the border width and a hovered one is raised (z-5);
                // the active tab stays on top so a hovered neighbour's grey edge never covers it.
                className:
                  'min-w-32 no-underline data-[state=active]:z-10! data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-fg sm:min-w-40',
              })}
            >
              {tab.label}
            </a>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {TABS.map((tab) => (
        <Tabs.Content key={tab.route} value={tab.route} className="outline-none">
          {panels[tab.route]}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  )
}
