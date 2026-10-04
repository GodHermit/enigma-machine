/**
 * Whether this browser can run the WebAssembly SIMD engine (validated locally with a tiny module
 * using a v128 instruction; nothing is fetched).
 */
let cached: boolean | null = null

export function wasmSimdAvailable(): boolean {
  if (cached === null) {
    try {
      // (module (func (result v128) i32.const 0 i8x16.splat i8x16.popcnt))
      const bytes = new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
      ])
      cached = typeof WebAssembly === 'object' && WebAssembly.validate(bytes)
    } catch {
      cached = false
    }
  }
  return cached
}
