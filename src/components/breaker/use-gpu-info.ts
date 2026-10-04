import { useEffect, useState } from 'react'

/** What this browser offers for the GPU backend (checked once per page, locally). */
export interface GpuInfo {
  state: 'checking' | 'ready' | 'none'
  /** Adapter name, e.g. "Apple Metal 3", when ready. */
  name: string | null
}

let probe: Promise<GpuInfo> | null = null

const pretty = (s: string): string => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

function probeGpu(): Promise<GpuInfo> {
  if (!probe) {
    probe = (async (): Promise<GpuInfo> => {
      const gpu = typeof navigator !== 'undefined' ? (navigator as Navigator & { gpu?: GPU }).gpu : undefined
      if (!gpu) return { state: 'none', name: null }
      try {
        const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
        if (!adapter) return { state: 'none', name: null }
        const info = adapter.info
        const name = [info?.vendor, info?.architecture || info?.description].filter(Boolean).map((s) => pretty(String(s))).join(' ')
        return { state: 'ready', name: name || 'GPU' }
      } catch {
        return { state: 'none', name: null }
      }
    })()
  }
  return probe
}

/** The GPU (WebGPU adapter) of this device, if any. */
export function useGpuInfo(): GpuInfo {
  const [info, setInfo] = useState<GpuInfo>({ state: 'checking', name: null })
  useEffect(() => {
    let alive = true
    probeGpu().then((i) => {
      if (alive) setInfo(i)
    })
    return () => {
      alive = false
    }
  }, [])
  return info
}
