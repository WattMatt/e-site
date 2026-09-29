import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({
  createClient: vi.fn(), requireSolarLevel: vi.fn(async () => 'edit'), audit: vi.fn(async () => {}), emit: vi.fn(async () => {}),
  revalidate: vi.fn(), org: vi.fn(async () => ({ organisationId: 'o1' })), requireRole: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
vi.mock('@/lib/auth-org', () => ({ getOrgContext: h.org }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: h.requireRole }))

import { linkHandoverDocumentAction, saveHandoverTemplateAction, setHandoverNotApplicableAction, syncHandoverItemsAction } from './solar-handover.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

const P = '11111111-1111-4111-8111-111111111111'
const item = { id: 'h1', installation_id: 'i1', item_key: 'coc', label: 'CoC' }
function setup(extra: Parameters<typeof fakeSupabase>[0] = {}) {
  const f = fakeSupabase({ userId: 'u1', tables: { 'solar.handover_items': [item] }, ...extra })
  h.createClient.mockResolvedValue(f.client)
  return f
}
beforeEach(() => { vi.clearAllMocks(); h.requireRole.mockResolvedValue({ ok: true }) })

describe('handover items', () => {
  it('links a Documents file (Edit, FIRST) and records who', async () => {
    const f = setup()
    await expect(linkHandoverDocumentAction({ projectId: P, itemId: 'h1', documentId: 'd1' })).resolves.toEqual({ ok: true })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
    expect(callsTo(f.calls, 'solar.handover_items', 'update')[0]!.payload).toEqual({ document_id: 'd1', not_applicable: false })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'handover_updated', objectRef: { item: 'CoC', documentId: 'd1' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: P, event: 'solar_handover_updated', properties: { change: 'linked' } })
  })
  it('a document from another project is refused in words', async () => {
    setup({ writes: { 'solar.handover_items:update': { error: { code: '23514', message: 'solar.handover_items: the document belongs to another project' } } } })
    await expect(linkHandoverDocumentAction({ projectId: P, itemId: 'h1', documentId: 'd2' })).resolves.toEqual({ error: 'The document belongs to another project.' })
  })
  it('N/A clears the document and keeps a note', async () => {
    const f = setup()
    await expect(setHandoverNotApplicableAction({ projectId: P, itemId: 'h1', notApplicable: true, note: '  No battery  ' })).resolves.toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.handover_items', 'update')[0]!.payload).toEqual({ not_applicable: true, document_id: null, note: 'No battery' })
  })
  it('adds template items the checklist lacks, never duplicating', async () => {
    const f = setup({ tables: { 'solar.handover_items': [item], 'solar.installations': [{ id: 'i1', organisation_id: 'o1' }], 'solar.handover_templates': [] } })
    await expect(syncHandoverItemsAction({ projectId: P, installationId: 'i1' })).resolves.toEqual({ ok: true, added: 8 })
    const rows = callsTo(f.calls, 'solar.handover_items', 'insert')[0]!.payload as Array<Record<string, unknown>>
    expect(rows.map((r) => r.item_key)).not.toContain('coc')
  })
})

describe('saveHandoverTemplateAction', () => {
  it('owner/admin only, validated, stale-guarded', async () => {
    h.requireRole.mockResolvedValue({ ok: false })
    setup()
    await expect(saveHandoverTemplateAction({ name: 'X', items: [{ key: 'coc', label: 'CoC', required: true }], expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'Only an organisation owner or admin can change the handover template.' })
    h.requireRole.mockResolvedValue({ ok: true })
    await expect(saveHandoverTemplateAction({ name: 'X', items: [], expectedUpdatedAt: null })).resolves.toHaveProperty('fieldErrors')
    const f = setup({ writes: { 'solar.handover_templates:insert': { data: [{ updated_at: 'T1' }] } } })
    await expect(saveHandoverTemplateAction({ name: 'Ours', items: [{ key: 'coc', label: 'CoC', required: true }], expectedUpdatedAt: null }))
      .resolves.toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(f.calls, 'solar.handover_templates', 'insert')[0]!.payload).toEqual({ organisation_id: 'o1', name: 'Ours', items: [{ key: 'coc', label: 'CoC', required: true }] })
  })
})
