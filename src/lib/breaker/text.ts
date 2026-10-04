/** A–Z only, uppercased (every other character, including accented letters, is dropped). */
export function lettersOnly(text: string): string {
  return text.replace(/[^A-Za-z]/g, '').toUpperCase()
}

/** Letter codes (A = 0) of the A–Z letters of `text`. */
export function toCodes(text: string): Uint8Array {
  const letters = lettersOnly(text)
  const out = new Uint8Array(letters.length)
  for (let i = 0; i < letters.length; i++) out[i] = letters.charCodeAt(i) - 65
  return out
}

/** Uppercase string of letter codes. */
export function fromCodes(codes: ArrayLike<number>): string {
  let s = ''
  for (let i = 0; i < codes.length; i++) s += String.fromCharCode(65 + codes[i])
  return s
}

/**
 * Index of coincidence: probability that two letters drawn without replacement are equal.
 * Random text ≈ 1/26 ≈ 0.0385, English ≈ 0.066, German ≈ 0.076. 0 for fewer than 2 letters.
 */
export function indexOfCoincidence(text: string | ArrayLike<number>): number {
  const codes = typeof text === 'string' ? toCodes(text) : text
  const n = codes.length
  if (n < 2) return 0
  const counts = new Int32Array(26)
  for (let i = 0; i < n; i++) counts[codes[i]]++
  let sum = 0
  for (let i = 0; i < 26; i++) sum += counts[i] * (counts[i] - 1)
  return sum / (n * (n - 1))
}

/** Fraction of positions where the two strings agree (compared over the shorter length; 0 when empty). */
export function letterAgreement(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let same = 0
  for (let i = 0; i < n; i++) if (a[i] === b[i]) same++
  return same / n
}

/** Ä→AE, Ö→OE, Ü→UE, ß→SS; other accents stripped. Punctuation and spacing are kept. */
export function transliterate(text: string): string {
  return text
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}
