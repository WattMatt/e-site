import { describe, it, expect } from 'vitest'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { loadTariffReadinessInput } from './readiness-input'

describe('loadTariffReadinessInput', () => {
  it('no study: null, and no tariff read', async () => {
    const { client, calls } = fakeSupabase()
    expect(await loadTariffReadinessInput(client as never, null)).toBeNull()
    expect(calls).toHaveLength(0)
  })
  it('reads whether the PINNED tariff has a linked export tariff', async () => {
    const { client } = fakeSupabase({ tables: { 'tariffs.tariff': [{ id: 't1', export_tariff_id: 'e1' }, { id: 't2', export_tariff_id: null }] } })
    expect(await loadTariffReadinessInput(client as never, { tariff_id: 't1', export_rule: { method: 'linked_tariff' } }))
      .toEqual({ tariffId: 't1', exportRule: { method: 'linked_tariff' }, hasLinkedExportTariff: true })
    expect(await loadTariffReadinessInput(client as never, { tariff_id: 't2', export_rule: { method: 'linked_tariff' } }))
      .toEqual({ tariffId: 't2', exportRule: { method: 'linked_tariff' }, hasLinkedExportTariff: false })
  })
  it('no tariff pinned: no tariff read', async () => {
    const { client, calls } = fakeSupabase()
    expect(await loadTariffReadinessInput(client as never, { tariff_id: null, export_rule: null }))
      .toEqual({ tariffId: null, exportRule: null, hasLinkedExportTariff: false })
    expect(callsTo(calls, 'tariffs.tariff', 'select')).toHaveLength(0)
  })
})
