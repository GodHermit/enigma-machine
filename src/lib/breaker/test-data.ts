/**
 * Test-only helper: reads the bundled n-gram statistics from disk (vitest runs in node, where
 * the app's `?url` + fetch path has no server). Uses process.getBuiltinModule so the app's
 * TypeScript config needs no Node typings.
 */
import { parseNgrams } from './ngrams'
import type { NgramModel } from './ngrams'
import type { BreakerLanguage } from './types'
import { parseDictionary } from './words'
import type { WordDictionary } from './words'

interface NodeFs {
  readFileSync(path: URL): Uint8Array
  readFileSync(path: URL, encoding: 'utf8'): string
}

const cache = new Map<BreakerLanguage, NgramModel>()

export function readNgramFile(language: BreakerLanguage): Uint8Array {
  // Not `new URL(literal, import.meta.url)`: Vite would rewrite that into an asset URL.
  const here = import.meta.url
  return fs().readFileSync(new URL(`./data/ngrams-${language}.bin`, here))
}

function fs(): NodeFs {
  const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
  const mod = proc?.getBuiltinModule?.('node:fs') as NodeFs | undefined
  if (!mod) throw new Error('test data helpers need Node.js ≥ 22.3')
  return mod
}

/** Contents of data/words-<lang>.txt. */
export function readWordFile(language: BreakerLanguage): string {
  const here = import.meta.url
  return fs().readFileSync(new URL(`./data/words-${language}.txt`, here), 'utf8')
}

/** Contents of data/readable-<lang>.txt (the Readable view's word list). */
export function readReadableFile(language: BreakerLanguage): string {
  const here = import.meta.url
  return fs().readFileSync(new URL(`./data/readable-${language}.txt`, here), 'utf8')
}

const dictionaries = new Map<BreakerLanguage, WordDictionary>()

export function testDictionary(language: BreakerLanguage): WordDictionary {
  let d = dictionaries.get(language)
  if (!d) {
    d = parseDictionary(readWordFile(language), language)
    dictionaries.set(language, d)
  }
  return d
}

export function testNgrams(language: BreakerLanguage): NgramModel {
  let model = cache.get(language)
  if (!model) {
    model = parseNgrams(readNgramFile(language), language)
    cache.set(language, model)
  }
  return model
}
