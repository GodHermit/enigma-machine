/**
 * Codebreaker Web Worker: runs search tasks handed out by the breaker (breaker.ts).
 * Loaded with `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.
 */
import type { WorkerRequest, WorkerResponse } from './protocol'
import { createWorkerHandler } from './worker-handler'

interface WorkerScope {
  postMessage(message: WorkerResponse): void
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
}

const scope = self as unknown as WorkerScope
const handle = createWorkerHandler((message) => scope.postMessage(message))
scope.onmessage = (event) => handle(event.data)
