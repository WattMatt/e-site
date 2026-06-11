import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GcrSettingsRow, TenantNodeRow } from '@esite/shared'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const saveMock = vi.fn()
const bulkMock = vi.fn()
vi.mock('./gcr.actions', () => ({
  saveTenantAssignmentAction: (...args: unknown[]) => saveMock(...args),
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

  it('bulk action calls the server action and flips local rows to standard', async () => {
    bulkMock.mockResolvedValue({ ok: true, updated: 2 })
    await renderPanel()

    await userEvent.click(screen.getByRole('button', { name: /set all uncategorized/i }))

    await waitFor(() => {
      expect(bulkMock).toHaveBeenCalledWith(PROJECT_ID)
      expect(refreshMock).toHaveBeenCalled()
    })
    // Placeholder gone — all rows now categorized locally
    expect(screen.queryByText('— set category —')).toBeNull()
    // Readiness gap cleared
    expect(screen.queryByText(/missing category/)).toBeNull()
  })

  it('choosing a category on an uncategorized row saves the real value (not a default)', async () => {
    saveMock.mockResolvedValue({ ok: true })
    await renderPanel()

    const selects = screen.getAllByRole('combobox')
    const categorySelects = selects.filter((s) =>
      Array.from((s as HTMLSelectElement).options).some((o) => o.text.includes('Fast food')),
    ) as HTMLSelectElement[]

    await userEvent.selectOptions(categorySelects[1], 'restaurant')
    categorySelects[1].blur()
    await userEvent.tab() // trigger blur-save

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({ node_id: 't2', shop_category: 'restaurant' }),
      )
    })
  })
})
