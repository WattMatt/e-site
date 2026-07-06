// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  it('renders only the Breaker header (no Load, no Amps)', () => {
    render(<ScheduleTable nodes={[tenant({})]} {...base} />)
    // getByText throws if absent, so a truthy result asserts presence.
    expect(screen.getByText('Breaker')).toBeTruthy()
    expect(screen.queryByText('Load')).toBeNull()
    expect(screen.queryByText('Amps')).toBeNull()
  })
  it('formats the breaker with poles', () => {
    render(<ScheduleTable nodes={[tenant({})]} {...base} />)
    expect(screen.getByText('63 A TP')).toBeTruthy()
  })
  it('shows an em-dash when the breaker is absent', () => {
    render(
      <ScheduleTable
        nodes={[tenant({
          incomer_breaker_a: null, incomer_pole_config: null,
          incomer_load_a: null, incomer_capacity_a: null,
        })]}
        {...base}
      />,
    )
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })
})

describe('ScheduleTable tenant editing', () => {
  it('opens the edit form modal prefilled from the row when Edit is clicked', async () => {
    render(<ScheduleTable nodes={[tenant({})]} {...base} />)

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((screen.getByLabelText(/SHOP NO/i) as HTMLInputElement).value).toBe('67')
    expect((screen.getByLabelText(/Tenant name/i) as HTMLInputElement).value).toBe('Shop 67')
    expect((screen.getByLabelText(/GLA/i) as HTMLInputElement).value).toBe('100')
    // Immutable DB code shown as context
    expect(screen.getAllByText(/DB-67/).length).toBeGreaterThanOrEqual(1)
  })

  it('readOnly hides every mutating control but keeps the data visible', async () => {
    render(<ScheduleTable nodes={[tenant({})]} {...base} readOnly />)

    // Row data still visible
    expect(screen.getByText('Shop 67')).toBeTruthy()
    // Mutating controls hidden
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Add scope item/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /recycle/i })).toBeNull()
    // BO cells render static text, not a select
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Edit BO date/i })).toBeNull()
    // Scope/Layout viewers stay available
    expect(screen.getByRole('button', { name: /Scope/ })).toBeTruthy()
  })

  it('does not offer Edit on decommissioned rows', async () => {
    render(<ScheduleTable nodes={[tenant({ status: 'decommissioned' })]} {...base} />)

    // Decommissioned rows are hidden by default — reveal them first.
    await userEvent.click(screen.getByLabelText(/Show decommissioned/i))

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })
})
