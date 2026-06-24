// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScheduleTable } from './ScheduleTable'
import type { Node } from '@esite/shared'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

function tenant(overrides: Partial<Node>): Node {
  return {
    id: 'n1', created_at: '', updated_at: '', project_id: 'p1', organisation_id: 'o1',
    kind: 'tenant_db', custom_kind_label: null, code: 'DB-67', name: null, coc_required: false,
    status: 'active', deleted_at: null, deleted_by: null, parent_node_id: null,
    shop_number: '67', shop_name: 'Shop 67', shop_area_m2: 100,
    breaker_rating_a: null, pole_config: null, section: null, rating_kva: null, voltage_v: null,
    incomer_breaker_a: 63, incomer_pole_config: 'TP', incomer_load_a: 60,
    incomer_capacity_a: 170, incomer_under_protected: false, incomer_multiple_feeds: false,
    incomer_source_revision_id: null, incomer_computed_at: null,
    notes: null, decommission_reason: null, created_by: null, ...overrides,
  }
}

const base = {
  deletedNodes: [] as Node[], projectId: 'p1', orgId: 'o1', scopeItemTypes: [],
  scopeItemsByNode: {}, tenantDetailsByNode: {}, layoutDetailsByNode: {},
  ordersByNodeAndScope: {}, tenantBoByNode: {},
}

describe('ScheduleTable electrical columns', () => {
  it('renders Breaker, Load and Amps headers', () => {
    render(<ScheduleTable nodes={[tenant({})]} {...base} />)
    // getByText throws if absent, so a truthy result asserts presence.
    expect(screen.getByText('Breaker')).toBeTruthy()
    expect(screen.getByText('Load')).toBeTruthy()
    expect(screen.getByText('Amps')).toBeTruthy()
  })
  it('formats breaker with poles, load and amps', () => {
    render(<ScheduleTable nodes={[tenant({})]} {...base} />)
    expect(screen.getByText('63 A TP')).toBeTruthy()
    expect(screen.getByText('60 A')).toBeTruthy()
    expect(screen.getByText('170 A')).toBeTruthy()
  })
  it('shows an em-dash when electrical data is absent', () => {
    render(
      <ScheduleTable
        nodes={[tenant({
          incomer_breaker_a: null, incomer_pole_config: null,
          incomer_load_a: null, incomer_capacity_a: null,
        })]}
        {...base}
      />,
    )
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })
})
