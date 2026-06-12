import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GcrSettingsRow, TenantNodeRow } from '@esite/shared'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const bulkSaveMock = vi.fn()
const bulkMock = vi.fn()
vi.mock('./gcr.actions', () => ({
  bulkSaveTenantAssignmentsAction: (...args: unknown[]) => bulkSaveMock(...args),
  bulkSetUncategorizedTenantsAction: (...args: unknown[]) => bulkMock(...args),
}))

const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROJECT_ID = '00000000-0000-0000-0000-000000000011'

const SETTINGS = { standard_kw_per_sqm: 0.03 } as unknown as GcrSettingsRow
const ZONES = [{ id: 'z1', zone_name: 'North', zone_number: 1, display_order: 0 }]
const GENERATORS = [{ id: 'g1', zone_id: 'z1', generator_number: 1, generator_size: '250 kVA', generator_cost: 1 }]

// One categorized, two uncategorized (NULL shop_category)
const TENANTS: TenantNodeRow[] = [
  { id: 't1', shop_number: 'T01', shop_name: 'Alpha',   shop_area_m2: 100, shop_category: 'fast_food', generator_participation: 'shared' },
  { id: 't2', shop_number: 'T02', shop_name: 'Bravo',   shop_area_m2: 200, shop_category: null,        generator_participation: 'shared' },
  { id: 't3', shop_number: 'T03', shop_name: 'Charlie', shop_area_m2: 300, shop_category: null,        generator_participation: 'shared' },
]

async function renderPanel() {
  const { TenantsPanel } = await import('./TenantsPanel')
  return render(
    <TenantsPanel
      projectId={PROJECT_ID}
      settings={SETTINGS}
      zones={ZONES}
      generators={GENERATORS}
      tenants={TENANTS}
      assignments={[]}
      onNavigateToReports={vi.fn()}
    />,
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TenantsPanel — uncategorized visibility + bulk action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the placeholder for uncategorized rows instead of a fake Standard', async () => {
    await renderPanel()
    const selects = screen.getAllByRole('combobox') // category + zone per row
    const categorySelects = selects.filter((s) =>
      Array.from((s as HTMLSelectElement).options).some((o) => o.text.includes('Fast food')),
    ) as HTMLSelectElement[]
    expect(categorySelects).toHaveLength(3)
    // t1 (categorized) shows its real value; t2/t3 sit on the placeholder
    expect(categorySelects[0].value).toBe('fast_food')
    expect(categorySelects[1].value).toBe('')
    expect(categorySelects[2].value).toBe('')
    expect(screen.getAllByText('— set category —')).toHaveLength(2)
  })

  it('counts uncategorized rows in the readiness gap and offers the bulk action', async () => {
    await renderPanel()
    expect(screen.getByText('2 tenant(s) missing category')).toBeDefined()
    expect(screen.getByRole('button', { name: /set all uncategorized to standard \(2\)/i })).toBeDefined()
  })

  it('bulk action calls the server action and refreshes server truth', async () => {
    bulkMock.mockResolvedValue({ ok: true, updated: 2 })
    await renderPanel()

    await userEvent.click(screen.getByRole('button', { name: /set all uncategorized/i }))

    await waitFor(() => {
      expect(bulkMock).toHaveBeenCalledWith(PROJECT_ID)
      expect(refreshMock).toHaveBeenCalled()
    })
  })

  it('choosing a category on an uncategorized row commits the real value on change', async () => {
    bulkSaveMock.mockResolvedValue({ ok: true, updated: 1 })
    await renderPanel()

    const selects = screen.getAllByRole('combobox')
    const categorySelects = selects.filter((s) =>
      Array.from((s as HTMLSelectElement).options).some((o) => o.text.includes('Fast food')),
    ) as HTMLSelectElement[]

    await userEvent.selectOptions(categorySelects[1], 'restaurant')

    await waitFor(() => {
      expect(bulkSaveMock).toHaveBeenCalledWith(PROJECT_ID, ['t2'], { shop_category: 'restaurant' })
    })
  })
})

describe('TenantsPanel — instant save with per-row status', () => {
  beforeEach(() => vi.clearAllMocks())

  it('zone select commits on change (no blur needed) with a single-node bulk call', async () => {
    bulkSaveMock.mockResolvedValue({ ok: true, updated: 1 })
    const user = userEvent.setup()
    await renderPanel()
    const zoneSelects = screen.getAllByLabelText(/zone for/i)
    await user.selectOptions(zoneSelects[0], 'z1')
    await waitFor(() =>
      expect(bulkSaveMock).toHaveBeenCalledWith(PROJECT_ID, ['t1'], { zone_id: 'z1' }),
    )
    expect(refreshMock).toHaveBeenCalled()
  })

  it('participation click failure reverts the cell and shows a retry affordance', async () => {
    bulkSaveMock.mockResolvedValue({ error: 'Forbidden' })
    const user = userEvent.setup()
    await renderPanel()
    // t1 starts 'shared'; click 'Own generator' on its row
    const row = screen.getByText('Alpha').closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Own generator' }))
    // error surfaced with retry; the segmented control is back on Shared
    // (plain matchers — this workspace has no @testing-library/jest-dom)
    await waitFor(() => expect(within(row).getByRole('button', { name: /retry/i })).toBeTruthy())
    expect(within(row).getByRole('button', { name: 'Shared' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(row).getByText('Forbidden')).toBeTruthy()
  })

  it('retry re-sends the failed patch', async () => {
    bulkSaveMock.mockResolvedValueOnce({ error: 'boom' }).mockResolvedValueOnce({ ok: true, updated: 1 })
    const user = userEvent.setup()
    await renderPanel()
    const row = screen.getByText('Alpha').closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Own generator' }))
    await user.click(await within(row).findByRole('button', { name: /retry/i }))
    await waitFor(() => expect(bulkSaveMock).toHaveBeenLastCalledWith(PROJECT_ID, ['t1'], { participation: 'own' }))
  })

  it('kW override commits on Enter', async () => {
    bulkSaveMock.mockResolvedValue({ ok: true, updated: 1 })
    const user = userEvent.setup()
    await renderPanel()
    const kwInputs = screen.getAllByLabelText(/manual kw for/i)
    await user.type(kwInputs[0], '12.5{Enter}')
    await waitFor(() =>
      expect(bulkSaveMock).toHaveBeenCalledWith(PROJECT_ID, ['t1'], { manual_kw_override: 12.5 }),
    )
  })

  it('a row save does NOT disable other rows', async () => {
    let resolve!: (v: unknown) => void
    bulkSaveMock.mockReturnValue(new Promise((r) => { resolve = r }))
    const user = userEvent.setup()
    await renderPanel()
    const rows = screen.getAllByRole('row')
    await user.click(within(rows[1]).getByRole('button', { name: 'Own generator' }))
    // While t1 is saving, t2's controls remain enabled
    expect((within(rows[2]).getByRole('button', { name: 'Shared' }) as HTMLButtonElement).disabled).toBe(false)
    resolve({ ok: true, updated: 1 })
  })
})

describe('TenantsPanel — filters + setup banner', () => {
  beforeEach(() => { vi.clearAllMocks(); bulkSaveMock.mockResolvedValue({ ok: true, updated: 1 }) })

  it('banner reports shops needing setup and Show applies the no-zone filter', async () => {
    const user = userEvent.setup()
    await renderPanel() // all 3 shared with no zone assignments → all need setup
    // banner text visible (all 3 are shared + missing zone)
    expect(screen.getByText(/3 shops need setup/i)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^show$/i }))
    // after clicking Show the no-zone chip should be aria-pressed="true"
    expect(screen.getByRole('button', { name: /no zone \(3\)/i }).getAttribute('aria-pressed')).toBe('true')
  })

  it('zone chip filters rows and select-all selects only the filtered set', async () => {
    const user = userEvent.setup()
    const assignments = [{ node_id: 't1', zone_id: 'z1', manual_kw_override: null }]
    const { TenantsPanel } = await import('./TenantsPanel')
    render(
      <TenantsPanel
        projectId={PROJECT_ID}
        settings={SETTINGS}
        zones={ZONES}
        generators={GENERATORS}
        tenants={TENANTS}
        assignments={assignments}
        onNavigateToReports={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /north \(1\)/i }))
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.queryByText('Bravo')).toBeNull()
    await user.click(screen.getByLabelText(/select all/i))
    expect(screen.getByText(/1 selected/i)).toBeTruthy()
  })

  it('changing filter clears the selection', async () => {
    const user = userEvent.setup()
    await renderPanel()
    await user.click(screen.getByLabelText(/select all/i))
    expect(screen.getByText(/3 selected/i)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^uncategorized/i }))
    expect(screen.queryByText(/selected/i)).toBeNull()
  })
})

describe('TenantsPanel — coverage strip', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows per-zone kW, capacity when parseable, and the configured count', async () => {
    const assignments = [{ node_id: 't1', zone_id: 'z1', manual_kw_override: null }]
    const { TenantsPanel } = await import('./TenantsPanel')
    render(
      <TenantsPanel
        projectId={PROJECT_ID}
        settings={SETTINGS}
        zones={ZONES}
        generators={GENERATORS}
        tenants={TENANTS}
        assignments={assignments}
        onNavigateToReports={vi.fn()}
      />,
    )
    const strip = screen.getByLabelText(/coverage/i)
    expect(within(strip).getByText('North')).toBeTruthy()
    expect(within(strip).getByText(/1 shop/)).toBeTruthy()
    expect(within(strip).getByText(/250 kVA/)).toBeTruthy()
    expect(within(strip).getByText(/1 of 3 configured/i)).toBeTruthy()
  })
})

describe('TenantsPanel — selection + bulk bar', () => {
  beforeEach(() => vi.clearAllMocks())

  it('select-all + bulk zone apply sends one call with all visible ids', async () => {
    bulkSaveMock.mockResolvedValue({ ok: true, updated: 3 })
    const user = userEvent.setup()
    await renderPanel()
    await user.click(screen.getByLabelText(/select all/i))
    await user.selectOptions(screen.getByLabelText(/bulk assign zone/i), 'z1')
    await user.click(screen.getByRole('button', { name: /^apply$/i }))
    await waitFor(() =>
      expect(bulkSaveMock).toHaveBeenCalledWith(PROJECT_ID, ['t1', 't2', 't3'], { zone_id: 'z1' }),
    )
    expect(await screen.findByText(/applied to 3 shops/i)).toBeTruthy()
  })

  it('bulk failure shows the error and a retry', async () => {
    bulkSaveMock.mockResolvedValueOnce({ error: 'Forbidden' }).mockResolvedValueOnce({ ok: true, updated: 3 })
    const user = userEvent.setup()
    await renderPanel()
    await user.click(screen.getByLabelText(/select all/i))
    await user.selectOptions(screen.getByLabelText(/bulk assign zone/i), 'z1')
    await user.click(screen.getByRole('button', { name: /^apply$/i }))
    // BulkBar renders a role="alert" span with the error and an inline Retry button
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Forbidden')
    // The inline Retry button is inside the alert span
    const retryBtn = within(alert).getByRole('button', { name: /retry/i })
    await user.click(retryBtn)
    await waitFor(() => expect(bulkSaveMock).toHaveBeenCalledTimes(2))
  })
})
