import { useEffect, useState } from 'react'
import type { ReadableDictionary } from '../../lib/breaker/readable'
import { loadReadableDictionary } from '../../lib/breaker/readable-data'
import type { BreakerLanguage } from '../../lib/breaker/types'

/** The "Readable" view's word list for a language, or null while it loads (or if it can't be loaded). */
export function useReadableDictionary(language: BreakerLanguage): ReadableDictionary | null {
  const [loaded, setLoaded] = useState<ReadableDictionary | null>(null)
  useEffect(() => {
    let live = true
    loadReadableDictionary(language).then(
      (dictionary) => {
        if (live) setLoaded(dictionary)
      },
      () => {
        // Offline or blocked: the view falls back to the codebreaker's own word split.
      },
    )
    return () => {
      live = false
    }
  }, [language])
  return loaded?.language === language ? loaded : null
}
