import { useSyncExternalStore } from 'react'

/**
 * Hash routing (works on any static host): `#/simulator` and `#/breaker`, each
 * with optional query parameters after `?`, e.g. `#/simulator?key=I.UKW-B.I-II-III.AAA.AAA.`.
 * Legacy share links (`#key=…`, no leading slash) open the simulator.
 */

export type Route = 'simulator' | 'breaker'

export const ROUTES: readonly Route[] = ['simulator', 'breaker']
export const DEFAULT_ROUTE: Route = 'simulator'

export interface ParsedHash {
  route: Route
  params: URLSearchParams
}

function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value)
}

/** Parses `#/breaker?x=1`, `#/simulator`, `#key=…` (legacy) or '' into a route + params. */
export function parseHash(hash: string): ParsedHash {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  if (!body.startsWith('/')) {
    // '' / '#' / legacy '#key=…': the simulator, with the whole body as parameters.
    return { route: DEFAULT_ROUTE, params: new URLSearchParams(body) }
  }
  const query = body.indexOf('?')
  const path = (query === -1 ? body : body.slice(0, query)).replace(/^\/+|\/+$/g, '')
  const params = new URLSearchParams(query === -1 ? '' : body.slice(query + 1))
  return { route: isRoute(path) ? path : DEFAULT_ROUTE, params }
}

/** Builds `#/route` or `#/route?params`. */
export function buildHash(route: Route, params?: URLSearchParams): string {
  const query = params?.toString() ?? ''
  return `#/${route}${query ? `?${query}` : ''}`
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

const currentRoute = (): Route => parseHash(window.location.hash).route
const serverRoute = (): Route => DEFAULT_ROUTE

/** The active route, re-rendering on hash changes. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute, serverRoute)
}

/**
 * Switches to another route. Parameters are kept when staying on the same route
 * and dropped when switching (a simulator key means nothing on the breaker page).
 */
export function navigate(route: Route, params?: URLSearchParams): void {
  const current = parseHash(window.location.hash)
  const next = buildHash(route, params ?? (current.route === route ? current.params : undefined))
  if (next !== window.location.hash) window.location.hash = next
}
