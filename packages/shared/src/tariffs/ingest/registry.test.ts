import { describe, expect, it } from 'vitest'
import { classifyLicensee, planRegistrySeed, validateRegistry, type RegistryEntry } from './registry'

const e = (name: string, over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  name, kind: 'municipal', province: 'GP', aliases: [name.toUpperCase()], notes: null, ...over,
})

describe('classifyLicensee (owner default 4)', () => {
  it.each([
    ['CITY POWER', 'metro'], ['CITY OF TSHWANE', 'metro'], ['CITY OF EKURHULENI', 'metro'], ['CITY OF CAPE ', 'metro'],
    ['ETHEKWINI', 'metro'], ['NELSON MANDELLA BAY METRO', 'metro'], ['BUFFALO CITY', 'metro'], ['CENTLEC MANGAUNG', 'metro'],
    ['Eskom', 'eskom'], ['Eskom (Local Authority tariffs)', 'eskom'],
    ['AECI', 'private'], ['WESTRAND PRIVATE DISTRIBUTORS', 'private'], ['VLEESBAAI DIENSTE', 'private'], ['DAMPLAAS', 'private'],
    ['SASOL SYNFUELS', 'industrial_private'], ['SASOLBURG', 'industrial_private'],
    ['ITHALA EZAKHENI', 'development_agency'], ['MEGA', 'development_agency'],
    ['CENTLEC - KOPANONG', 'municipal'], ['LEPHALALE', 'municipal'], ['EPHRAIM MOGALE', 'municipal'], ['UMKHANYAKUDE', 'municipal'],
  ] as const)('%s -> %s', (name, kind) => expect(classifyLicensee(name)).toBe(kind))
})

describe('validateRegistry', () => {
  it('accepts a clean registry', () => {
    expect(validateRegistry([e('City Power', { kind: 'metro' }), e('Lephalale', { province: 'LP' })])).toEqual([])
  })
  it('refuses duplicate names, unnormalised aliases, alias collisions and unknown provinces', () => {
    const problems = validateRegistry([
      e('City Power'), e('City Power'),
      e('Mogale City', { aliases: ['MOGALE CITY', 'modale  city'] }),
      e('Other', { aliases: ['MOGALE CITY'] }),
      e('Nowhere', { province: 'XX' as never }),
    ])
    expect(problems.join('\n')).toMatch(/duplicate name "City Power"/)
    expect(problems.join('\n')).toMatch(/alias "modale {2}city" is not normalised/)
    expect(problems.join('\n')).toMatch(/alias "MOGALE CITY" is claimed by "Mogale City" and "Other"/)
    expect(problems.join('\n')).toMatch(/province "XX"/)
  })
})

describe('planRegistrySeed', () => {
  it('inserts new licensees, adds missing aliases to existing ones, and reports alias conflicts', () => {
    const plan = planRegistrySeed(
      [e('City Power', { aliases: ['CITY POWER', 'CITY POWER JHB'] }), e('Lephalale', { aliases: ['LEPHALALE'] }), e('Tshwane', { aliases: ['CITY OF TSHWANE'] })],
      {
        licensees: [{ id: 'l1', name: 'City Power' }, { id: 'l2', name: 'Somebody Else' }],
        aliases: [{ alias: 'CITY POWER', licenseeId: 'l1' }, { alias: 'CITY OF TSHWANE', licenseeId: 'l2' }],
      },
    )
    expect(plan.insert.map((x) => x.name)).toEqual(['Lephalale'])
    expect(plan.addAliases).toEqual([{ licenseeId: 'l1', name: 'City Power', aliases: ['CITY POWER JHB'] }])
    expect(plan.conflicts).toEqual([{ alias: 'CITY OF TSHWANE', wanted: 'Tshwane', heldBy: 'Somebody Else' }])
    // Tshwane is not inserted while one of its aliases is held by another licensee.
    expect(plan.blocked.map((x) => x.name)).toEqual(['Tshwane'])
  })
})
