import { defineConfig } from 'vitest/config'

/**
 * Accuracy / speed benchmark of the codebreaker (slow; not part of `yarn test`):
 *   yarn vitest run --config scripts/vitest.bench.config.ts
 * Options via environment variables, see scripts/breaker-benchmark.bench.ts.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/**/*.bench.ts'],
    testTimeout: 0,
    hookTimeout: 0,
    reporters: ['default'],
  },
})
