/** Fixed benchmark messages with known keys (shared by the breaker benchmarks). */
import { lettersOnly } from '../src/lib/breaker/text'
import { PASSAGES } from '../src/lib/breaker/data/passages'
import type { BreakerLanguage } from '../src/lib/breaker/types'

export interface Case {
  name: string
  language: BreakerLanguage
  /** Plaintext letters (taken from the bundled held-out passages unless given). */
  plain: string
  key: string
}

const passage = (language: BreakerLanguage, index: number, length: number): string =>
  PASSAGES[language].map((p) => lettersOnly(p.text)).join('').slice(index * 400, index * 400 + length)

/** Fixed cases (keys written out so the benchmark never changes between runs). */
export const CASES: Case[] = [
  {
    name: 'user report: en 263, 10 plugs, UKW-A, left turnover at 113',
    language: 'en',
    plain: lettersOnly(
      'A quiet city wakes beneath a pale silver sky, while distant trains hum softly beyond the rooftops. Somewhere, a window opens, coffee begins to brew, and another ordinary morning quietly turns into something unexpected. The streets remain empty, carrying yesterday’s rain and a thousand untold stories toward the horizon.',
    ),
    key: 'I.UKW-A.V-III-IV.SPI.YQB.TO-UH-PM-NY-CA-JB-KS-WX-ZR-VL',
  },
  { name: 'de 300, 10 plugs', language: 'de', plain: passage('de', 1, 300), key: 'I.UKW-B.II-IV-I.CKR.MDU.AQ-BJ-CW-DX-EI-FN-GT-HY-KO-LZ' },
  { name: 'en 300, 10 plugs', language: 'en', plain: passage('en', 1, 300), key: 'I.UKW-B.III-V-II.GAN.XOE.AT-BL-DF-GJ-HM-NW-OP-QY-RZ-SU' },
  { name: 'de 250, 10 plugs', language: 'de', plain: passage('de', 2, 250), key: 'I.UKW-B.IV-I-V.QMB.HHZ.AZ-BY-CX-DW-EV-FU-GT-HS-IR-JQ' },
  { name: 'en 250, no plugboard', language: 'en', plain: passage('en', 2, 250), key: 'I.UKW-B.I-V-III.TBX.EQA.' },
  { name: 'de 150, 10 plugs', language: 'de', plain: passage('de', 3, 150), key: 'I.UKW-B.V-II-IV.LLD.RAW.AM-BN-CO-DP-EQ-FR-GS-HT-IU-JV' },
  { name: 'en 150, no plugboard', language: 'en', plain: passage('en', 3, 150), key: 'I.UKW-B.II-III-I.HUJ.KZC.' },
  { name: 'de 200, 6 plugs', language: 'de', plain: passage('de', 4, 200), key: 'I.UKW-B.I-IV-II.BXF.QNL.AK-CR-EW-GM-IU-OS' },
]
