// `yarn build:wasm`: compiles the AssemblyScript phase-1 kernels (src-wasm/phase1.ts) into
// src/lib/breaker/wasm/phase1.wasm (SIMD, used by the app) and phase1-scalar.wasm (same code
// without SIMD; tests and scripts/wasm-speed.bench.ts measure what SIMD gains). Both are committed,
// so `yarn build` / `yarn test` never need the compiler.
import asc from 'assemblyscript/asc'

const common = [
  'src-wasm/phase1.ts',
  '--runtime', 'stub',
  '-O3',
  '--noAssert',
  '--use', 'abort=',
  '--initialMemory', '1',
]
const builds = [
  { out: 'src/lib/breaker/wasm/phase1.wasm', extra: ['--enable', 'simd'] },
  { out: 'src/lib/breaker/wasm/phase1-scalar.wasm', extra: [] },
]
for (const b of builds) {
  const { error, stderr } = await asc.main([...common, ...b.extra, '--outFile', b.out])
  if (error) {
    console.error(stderr.toString())
    console.error(error.message)
    process.exit(1)
  }
  console.log(`wrote ${b.out}`)
}
