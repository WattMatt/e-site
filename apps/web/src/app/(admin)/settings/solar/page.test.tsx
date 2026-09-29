import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fakeSupabase } from '@/test/fake-supabase'

const h = vi.hoisted(() => ({ tables: {} as Record<string, Array<Record<string, unknown>>>, tpl: vi.fn((p: unknown) => { void p }), ho: vi.fn((p: unknown) => { void p }) }))
vi.mock('@/lib/auth/require-role', () => ({ requireRolePage: vi.fn(async () => ({ organisationId: 'o1' })) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeSupabase({ tables: h.tables }).client }))
vi.mock('./SolarSettingsForm', () => ({ SolarSettingsForm: () => <div>form</div> }))
vi.mock('./ProposalTemplatesForm', () => ({ ProposalTemplatesForm: (p: unknown) => { h.tpl(p); return <div>templates</div> } }))
vi.mock('./HandoverTemplateForm', () => ({ HandoverTemplateForm: (p: unknown) => { h.ho(p); return <div>handover</div> } }))
import { DEFAULT_HANDOVER_TEMPLATE } from '@esite/shared/solar-operations/client'
import SolarSettingsPage from './page'

beforeEach(() => { vi.clearAllMocks(); h.tables = { 'solar.org_settings': [], 'solar.proposal_templates': [], 'solar.handover_templates': [] } })

describe('/settings/solar', () => {
  it('links the equipment catalogue; Rate card, Equipment and Branding are no longer "coming later"', async () => {
    render(await SolarSettingsPage())
    expect(screen.getByRole('link', { name: 'Equipment catalogue →' }).getAttribute('href')).toBe('/settings/solar/equipment')
    expect(screen.queryByText('Rate card — coming in a later phase')).toBeNull()
    expect(screen.queryByText('Equipment catalogue — coming in a later phase')).toBeNull()
    expect(screen.queryByText('Branding for Solar reports — coming in a later phase')).toBeNull()
    expect(screen.getByText('Load densities — coming in a later phase')).toBeTruthy()
  })
  it('proposal templates card: the defaults when none are saved', async () => {
    render(await SolarSettingsPage())
    expect(h.tpl).toHaveBeenCalledWith({ initial: { termsText: '', disclaimerText: '', validityDays: 30 }, updatedAt: null })
  })
  it('proposal templates card: the org’s saved row (and only its own org’s)', async () => {
    h.tables['solar.proposal_templates'] = [
      { organisation_id: 'o2', terms_text: 'Other org', disclaimer_text: 'x', validity_days: 7, updated_at: 'T9' },
      { organisation_id: 'o1', terms_text: 'Our terms', disclaimer_text: 'Our disclaimer', validity_days: 45, updated_at: 'T1' },
    ]
    render(await SolarSettingsPage())
    expect(h.tpl).toHaveBeenCalledWith({ initial: { termsText: 'Our terms', disclaimerText: 'Our disclaimer', validityDays: 45 }, updatedAt: 'T1' })
  })
  it('handover template card: the built-in default when none is saved', async () => {
    render(await SolarSettingsPage())
    expect(h.ho).toHaveBeenCalledWith({ initial: DEFAULT_HANDOVER_TEMPLATE, updatedAt: null })
  })
  it('handover template card: the org’s saved template (and only its own org’s)', async () => {
    const items = [{ key: 'coc', label: 'CoC', required: true }]
    h.tables['solar.handover_templates'] = [
      { organisation_id: 'o2', name: 'Other org', items, updated_at: 'T9' },
      { organisation_id: 'o1', name: 'Our checklist', items, updated_at: 'H1' },
    ]
    render(await SolarSettingsPage())
    expect(h.ho).toHaveBeenCalledWith({ initial: { name: 'Our checklist', items }, updatedAt: 'H1' })
  })
})
