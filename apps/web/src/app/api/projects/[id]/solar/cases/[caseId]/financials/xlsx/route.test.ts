import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { fakeSupabase } from '@/test/fake-supabase'

const h = vi.hoisted(() => ({ gate: vi.fn(), user: { current: null as unknown }, build: vi.fn(async () => Buffer.from('xlsx')) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => h.user.current) }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: h.gate }))
vi.mock('@/lib/solar/cases/xlsx', () => ({ buildFinancialsWorkbook: h.build }))
import { GET, runtime } from './route'

const P = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222'
const call = (c = C) => GET(new Request('http://x'), { params: Promise.resolve({ id: P, caseId: c }) })
beforeEach(() => { vi.clearAllMocks(); h.gate.mockResolvedValue({ ok: true, level: 'edit_financials', userId: 'u1' }) })

describe('GET …/financials/xlsx', () => {
  it('declares nodejs; refuses a malformed id', async () => {
    expect(runtime).toBe('nodejs')
    h.user.current = fakeSupabase({}).client
    expect((await call('nope')).status).toBe(400)
    expect(h.gate).not.toHaveBeenCalled()
  })
  it('needs Edit + financials (money), checked FIRST', async () => {
    const f = fakeSupabase({})
    h.user.current = f.client
    h.gate.mockResolvedValueOnce({ ok: false, response: NextResponse.json({}, { status: 403 }) })
    expect((await call()).status).toBe(403)
    expect(h.gate).toHaveBeenCalledWith(h.user.current, P, 'edit_financials')
    expect(f.calls).toHaveLength(0)
    expect(h.build).not.toHaveBeenCalled()
  })
  it('404 before financials were run; otherwise an xlsx attachment built from the stored row', async () => {
    h.user.current = fakeSupabase({ tables: { 'solar.cases': [{ id: C, project_id: P, name: 'Base' }], 'projects.projects': [{ id: P, name: 'KW' }], 'solar.case_run_financials': [] } }).client
    expect((await call()).status).toBe(404)
    const row = { case_id: C, created_at: 'T', engine_version: '0.1.0', tariff_ref: {}, fin_inputs: { config: { capex: [] } }, results: {} }
    h.user.current = fakeSupabase({ tables: { 'solar.cases': [{ id: C, project_id: P, name: 'Base' }], 'projects.projects': [{ id: P, name: 'KW' }], 'solar.case_run_financials': [row] } }).client
    const res = await call()
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="KW - Base - financials.xlsx"')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(h.build).toHaveBeenCalledWith({ projectName: 'KW', caseName: 'Base', row, capexLines: [] })
  })
  it('the file name cannot carry header-breaking characters', async () => {
    const row = { case_id: C, created_at: 'T', engine_version: '0.1.0', tariff_ref: {}, fin_inputs: { config: { capex: [] } }, results: {} }
    h.user.current = fakeSupabase({ tables: { 'solar.cases': [{ id: C, project_id: P, name: 'A"b\r\nc' }], 'projects.projects': [{ id: P, name: 'KW' }], 'solar.case_run_financials': [row] } }).client
    const res = await call()
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="KW - A_b_c - financials.xlsx"')
  })
})
