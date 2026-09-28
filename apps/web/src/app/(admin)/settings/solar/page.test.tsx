import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fakeSupabase } from '@/test/fake-supabase'

vi.mock('@/lib/auth/require-role', () => ({ requireRolePage: vi.fn(async () => ({ organisationId: 'o1' })) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeSupabase({ tables: { 'solar.org_settings': [] } }).client }))
vi.mock('./SolarSettingsForm', () => ({ SolarSettingsForm: () => <div>form</div> }))
import SolarSettingsPage from './page'

describe('/settings/solar', () => {
  it('links the equipment catalogue; Rate card and Equipment are no longer "coming later"', async () => {
    render(await SolarSettingsPage())
    expect(screen.getByRole('link', { name: 'Equipment catalogue →' }).getAttribute('href')).toBe('/settings/solar/equipment')
    expect(screen.queryByText('Rate card — coming in a later phase')).toBeNull()
    expect(screen.queryByText('Equipment catalogue — coming in a later phase')).toBeNull()
    expect(screen.getByText('Load densities — coming in a later phase')).toBeTruthy()
  })
})
