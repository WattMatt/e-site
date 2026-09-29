import { describe, it, expect } from 'vitest'
import { tariffReadiness, toTariffReadinessInput, withTariffReadiness } from './readiness'
import { computeSolarReadiness } from '../readiness'

describe('tariff readiness (spec §2.3 Tariff row)', () => {
  it('grey until a tariff is pinned; amber without an export rule; green with both', () => {
    expect(tariffReadiness(null)).toEqual({ status: 'grey', reason: 'Not started' })
    expect(tariffReadiness({ tariffId: null, exportRule: null, hasLinkedExportTariff: false })).toEqual({ status: 'grey', reason: 'Not started' })
    expect(tariffReadiness({ tariffId: 't', exportRule: null, hasLinkedExportTariff: false })).toEqual({ status: 'amber', reason: 'Missing: export credit rule' })
    expect(tariffReadiness({ tariffId: 't', exportRule: { version: 1, method: 'none' }, hasLinkedExportTariff: false }))
      .toEqual({ status: 'green', reason: 'Tariff and export credit rule are set' })
  })
  it('a linked-tariff rule is amber when the pinned tariff has no linked export tariff (e.g. after re-pinning)', () => {
    const linked = { version: 1, method: 'linked_tariff' }
    expect(tariffReadiness({ tariffId: 't', exportRule: linked, hasLinkedExportTariff: true }))
      .toEqual({ status: 'green', reason: 'Tariff and export credit rule are set' })
    expect(tariffReadiness({ tariffId: 't', exportRule: linked, hasLinkedExportTariff: false }))
      .toEqual({ status: 'amber', reason: 'The pinned tariff has no linked export tariff: choose another export rule' })
  })
  it('reads a studies row', () => {
    expect(toTariffReadinessInput({ tariff_id: 't', export_rule: { method: 'none' } }, true))
      .toEqual({ tariffId: 't', exportRule: { method: 'none' }, hasLinkedExportTariff: true })
    expect(toTariffReadinessInput(null, false)).toBeNull()
  })
  it('replaces the tariff step only, and makes it live', () => {
    const steps = withTariffReadiness(computeSolarReadiness(null, 'edit_financials'), { tariffId: 't', exportRule: null, hasLinkedExportTariff: false })
    const t = steps.find((s) => s.slug === 'tariff')!
    expect(t).toEqual({ slug: 'tariff', label: 'Tariff', live: true, status: 'amber', reason: 'Missing: export credit rule' })
    expect(steps.find((s) => s.slug === 'financials')!.live).toBe(false)
  })
  it('a level without the Tariff tab has no tariff step to replace', () => {
    expect(withTariffReadiness(computeSolarReadiness(null, 'edit'), null).some((s) => s.slug === 'tariff')).toBe(false)
  })
})
