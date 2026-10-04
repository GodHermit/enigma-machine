import { describe, expect, it } from 'vitest'
import { parseReadableWords, readableText, splitReadable } from './readable'
import { readReadableFile } from './test-data'

const real = (language: 'de' | 'en') => parseReadableWords(readReadableFile(language), language)

describe('splitReadable', () => {
  const small = parseReadableWords(['THE', 'A', 'TO', 'PULL', 'LITTLE', 'ULLA', 'NEXT'].join('\n'), 'en')

  it('prefers common words to rare ones', () => {
    expect(readableText('PULLALITTLE', small)).toBe('PULL A LITTLE')
  })

  it('keeps unknown letters together as one fragment', () => {
    expect(splitReadable('THEQZVTO', small)).toEqual(['THE', 'QZV', 'TO'])
  })

  it('reads X as a word separator but keeps it inside words', () => {
    expect(splitReadable('THEXNEXT', small)).toEqual(['THE', 'NEXT'])
  })

  it('handles empty input', () => {
    expect(splitReadable('', small)).toEqual([])
  })

  it('matches German words written with Q for CH', () => {
    const de = parseReadableWords(['NACHT', 'DIE'].join('\n'), 'de')
    expect(splitReadable('DIENAQT', de)).toEqual(['DIE', 'NAQT'])
  })
})

describe('bundled word lists', () => {
  it('splits English plaintext into the intended words', () => {
    expect(
      readableText('ICANNOTKEEPHERHEADFORTHESTOCKADESIRSAIDITOTHECAPTAINCOULDYOUPULLALITTLESTRONGER', real('en')),
    ).toBe('I CANNOT KEEP HER HEAD FOR THE STOCKADE SIR SAID I TO THE CAPTAIN COULD YOU PULL A LITTLE STRONGER')
  })

  it('splits a German radio message with X separators and Q for CH', () => {
    expect(readableText('ANXOBERKOMMANDOXDERXWEHRMAQTXXUBOOTXZWOXMELDETXFEINDLIQEXSTREITKRAEFTE', real('de'))).toBe(
      'AN OBERKOMMANDO DER WEHRMAQT UBOOT ZWO MELDET FEINDLIQE STREITKRAEFTE',
    )
  })
})
