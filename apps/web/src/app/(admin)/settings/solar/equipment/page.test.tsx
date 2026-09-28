import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fakeSupabase } from '@/test/fake-supabase'

const h = vi.hoisted(() => ({ gate: vi.fn(), client: vi.fn(), cat: vi.fn() }))
vi.mock('@/lib/auth/require-role', () => ({ requireRolePage: h.gate }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.client }))
vi.mock('./EquipmentCatalogue', () => ({ EquipmentCatalogue: (p: unknown) => { h.cat(p); return <div>catalogue</div> } }))
import SolarEquipmentPage from './page'

const eq = (id: string, org: string | null, extra: Record<string, unknown> = {}) => ({ id, organisation_id: org, kind: 'module', make: 'M', model: id, specs: { pmaxW: 550, gammaPmaxPctPerC: -0.35 }, source: 'manual', retired_at: null, updated_at: 'T', ...extra })
beforeEach(() => vi.clearAllMocks())

describe('/settings/solar/equipment', () => {
  it('gates OWNER_ADMIN FIRST — a refused caller never reads the catalogue', async () => {
    h.gate.mockRejectedValueOnce(new Error('NEXT_REDIRECT'))
    await expect(SolarEquipmentPage()).rejects.toThrow('NEXT_REDIRECT')
    expect(h.gate).toHaveBeenCalledWith(expect.arrayContaining(['owner', 'admin']))
    expect(h.client).not.toHaveBeenCalled()
  })
  it('shows the active org rows + platform rows only (JSON props), with the CSV header from the shared parser', async () => {
    h.gate.mockResolvedValueOnce({ organisationId: 'o1' })
    h.client.mockResolvedValueOnce(fakeSupabase({ tables: { 'solar.equipment': [eq('plat', null, { source: 'seed' }), eq('mine', 'o1', { retired_at: '2026-09-01' }), eq('other', 'o2')] } }).client)
    render(await SolarEquipmentPage())
    expect(screen.getByText('catalogue')).toBeTruthy()
    const props = h.cat.mock.calls[0]![0] as { rows: Array<{ id: string; platform: boolean; retired: boolean }>; csvHeader: string }
    expect(props.rows.map((r) => [r.id, r.platform, r.retired])).toEqual([['plat', true, false], ['mine', false, true]])
    expect(props.csvHeader.startsWith('kind,make,model,pmaxW')).toBe(true)
    expect(JSON.parse(JSON.stringify(props))).toEqual(props)
  })
})
