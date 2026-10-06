import { describe, expect, it } from 'vitest'
import { normaliseLicenseeText, searchLicensees, type LicenseeSearchItem } from './search'

const L = (id: string, name: string, aliases: string[] = [], liveFy: string | null = '2026/27', province = 'GP'): LicenseeSearchItem => ({
  id, name, kind: 'municipal', province, aliases, liveFy,
})
const LIST: LicenseeSearchItem[] = [
  L('nmb', 'NELSON MANDELLA BAY METRO', ['NELSON MANDELA BAY', 'NMBM']),
  L('cpt', 'CITY OF CAPE TOWN', ['CITY OF CAPE']),
  L('cp', 'CITY POWER', ['CITY POWER JOHANNESBURG']),
  L('ema-ec', 'EMALAHLENI EC', [], '2025/26', 'EC'),
  L('ema-mp', 'EMALAHLENI', [], null, 'MP'),
  L('esk', 'ESKOM', ['ESKOM HOLDINGS']),
]

describe('normaliseLicenseeText', () => {
  it('matches the licensee_alias normal form: trimmed, single-spaced, upper case', () => {
    expect(normaliseLicenseeText('  city   of cape\ttown ')).toBe('CITY OF CAPE TOWN')
  })
})

describe('searchLicensees', () => {
  it('finds a licensee by an alias and says which alias matched', () => {
    const r = searchLicensees('nelson mandela', LIST)
    expect(r[0].id).toBe('nmb')
    expect(r[0].matchedAlias).toBe('NELSON MANDELA BAY')
  })

  it('ignores punctuation and spacing differences', () => {
    expect(searchLicensees('citypower', LIST)[0].id).toBe('cp')
  })

  it('ranks an exact name before a prefix before a substring', () => {
    const r = searchLicensees('emalahleni', LIST).map((x) => x.id)
    expect(r[0]).toBe('ema-mp')
    expect(r).toContain('ema-ec')
  })

  it('puts a licensee with a published year before one without, at equal rank', () => {
    const list = [L('a', 'ALPHA TOWN', [], null), L('b', 'ALPHA CITY', [], '2026/27')]
    expect(searchLicensees('alpha', list).map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('returns every licensee, sorted by name, for an empty query', () => {
    const r = searchLicensees('   ', LIST)
    expect(r).toHaveLength(LIST.length)
    expect(r[0].name).toBe('CITY OF CAPE TOWN')
    expect(r.every((x) => x.matchedAlias === null)).toBe(true)
  })

  it('returns nothing when nothing matches', () => {
    expect(searchLicensees('zzz', LIST)).toEqual([])
  })

  it('honours the limit', () => {
    expect(searchLicensees('', LIST, 2)).toHaveLength(2)
  })
})
