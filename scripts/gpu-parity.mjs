// `yarn test:gpu`: proves the WebGPU phase-1 backend is bit-identical to the CPU in a real
// browser. Starts a Vite dev server, opens tests/gpu/parity.html in Chrome (WebGPU), compares
// stage A, stage B and the unit survivors for a few fixed messages and rotor orders, and prints
// timings. Exit code 1 on any difference; skipped (exit 0) when the machine has no WebGPU adapter.
//
//   yarn test:gpu [cases]        e.g. yarn test:gpu 0,3,7   (indexes into scripts/breaker-cases.ts)
//   CHROME=/path/to/chrome yarn test:gpu
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')

const cases = process.argv[2] ?? '0,3,7'
const extra = process.argv[3] ?? ''
const executablePath = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' })
await server.listen()
const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? 'http://localhost:5199'
const browser = await chromium.launch({ executablePath, headless: true })
let failed = false
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', String(e)))
  await page.goto(`${base}/tests/gpu/parity.html?cases=${cases}${extra ? '&' + extra : ''}`)
  await page.waitForFunction(() => window.__parity, null, { timeout: 0, polling: 1000 })
  const result = await page.evaluate(() => window.__parity)
  if (result.error) {
    if (/WebGPU backend unavailable/.test(result.error)) {
      console.log('SKIPPED: this browser / machine has no WebGPU adapter.')
    } else {
      console.log('ERROR:', result.error)
      failed = true
    }
  } else {
    console.log(`GPU: ${result.adapter}`)
    for (const r of result.reports) {
      const ok = r.screenEqual && r.screenPEqual && r.finalsEqual && r.survivorsEqual
      if (!ok) failed = true
      const speed = r.cpu.unitMs ? ` (${(r.cpu.unitMs / r.gpu.unitMs).toFixed(1)}× one CPU core)` : ''
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${r.case} · ${r.unit}  CPU ${r.cpu.unitMs} ms  GPU ${r.gpu.unitMs} ms${speed}${r.firstDiff ? `  first difference: ${r.firstDiff}` : ''}`,
      )
    }
  }
} finally {
  await browser.close()
  await server.close()
}
process.exit(failed ? 1 : 0)
