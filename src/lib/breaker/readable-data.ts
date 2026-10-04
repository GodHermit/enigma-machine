import deReadableUrl from './data/readable-de.txt?url'
import enReadableUrl from './data/readable-en.txt?url'
import { parseReadableWords } from './readable'
import type { ReadableDictionary } from './readable'
import type { BreakerLanguage } from './types'

const URLS: Record<BreakerLanguage, string> = { de: deReadableUrl, en: enReadableUrl }
const cache = new Map<BreakerLanguage, Promise<ReadableDictionary>>()

/**
 * The word list of the "Readable" view for a language (fetched on first use, about 200 KB
 * gzipped, parsed once and cached; a failed load is retried on the next call).
 */
export function loadReadableDictionary(language: BreakerLanguage): Promise<ReadableDictionary> {
  let p = cache.get(language)
  if (!p) {
    p = fetch(URLS[language])
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load the ${language} word list (HTTP ${res.status}).`)
        return res.text()
      })
      .then((text) => parseReadableWords(text, language))
    p.catch(() => cache.delete(language))
    cache.set(language, p)
  }
  return p
}
