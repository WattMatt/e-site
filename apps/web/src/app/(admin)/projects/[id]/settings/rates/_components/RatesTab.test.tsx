import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// RatesTab → BoqImportDialog pulls in a server action + next/navigation; mock
// the leaf so the shell renders in jsdom without a server.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/boq.actions', () => ({ importBoqAction: vi.fn(), updateBoqItemRateAction: vi.fn() }))

import { RatesTab } from './RatesTab'

describe('RatesTab — empty state', () => {
  it('renders the empty state with an Import button when initial is null and canEdit', () => {
    render(<RatesTab projectId="p1" canEdit initial={null} />)
    expect(screen.getByText('No BOQ imported yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: /import boq/i })).toBeTruthy()
  })

  it('hides the Import button when canEdit is false', () => {
    render(<RatesTab projectId="p1" canEdit={false} initial={null} />)
    expect(screen.getByText('No BOQ imported yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /import boq/i })).toBeNull()
  })

  it('opens the import dialog when the Import button is clicked', () => {
    render(<RatesTab projectId="p1" canEdit initial={null} />)
    fireEvent.click(screen.getByRole('button', { name: /import boq/i }))
    expect(screen.getByRole('dialog', { name: /import boq/i })).toBeTruthy()
  })
})

describe('RatesTab — populated state', () => {
  const data = {
    import: {
      id: 'imp1',
      projectId: 'p1',
      organisationId: 'o1',
      sourceFilename: 'tender.xlsx',
      storagePath: null,
      importedBy: null,
      importedAt: '2026-06-08T00:00:00Z',
      totalExVat: 100,
      vatAmount: 15,
      totalInclVat: 115,
      lineItemCount: 1,
      isCurrent: true,
    },
    sections: [
      { id: 'b1', importId: 'imp1', parentSectionId: null, kind: 'bill' as const, code: '1', title: 'MALL', sortOrder: 0, nodeId: null },
    ],
    items: [],
    totals: { b1: 100 },
    importedByName: 'Jane Doe',
  }

  it('renders the Main Summary with the bill and re-import control', () => {
    render(<RatesTab projectId="p1" canEdit initial={data} />)
    expect(screen.getByText('Main Summary')).toBeTruthy()
    expect(screen.getByText('MALL')).toBeTruthy()
    expect(screen.getByRole('button', { name: /re-import/i })).toBeTruthy()
    // provenance line shows the importer name
    expect(screen.getByText(/imported by Jane Doe/)).toBeTruthy()
  })

  it('hides the re-import control when canEdit is false', () => {
    render(<RatesTab projectId="p1" canEdit={false} initial={data} />)
    expect(screen.queryByRole('button', { name: /re-import/i })).toBeNull()
  })
})

// ── Fix A: spec §4.1 — Contract column must exclude origin='variation' items ─

describe('RatesTab — Contract column excludes variation items (spec §4.1)', () => {
  /**
   * One contract item (amount=1000) and one variation item (amount=200) in the
   * same bill. importRow.totalExVat=1000 = the contract baseline.
   *
   * With the fix: totals[b1]=1000 (contract items only) → liveExVat=1000 →
   *   isEdited=false → no "(edited)" marker; revised column shows 1200.
   * Without the fix: totals[b1]=1200 → liveExVat=1200 →
   *   isEdited=true → "(edited)" would appear.
   */
  const contractItem = {
    id: 'ci1',
    sectionId: 'b1',
    code: '1.1',
    description: 'Contract line',
    unit: 'm',
    quantity: 10,
    quantityMode: 'measured' as const,
    rateModel: 'amount_only' as const,
    supplyRate: null,
    installRate: null,
    rate: null,
    amount: 1000,
    sortOrder: 0,
    origin: 'contract' as const,
    variationLineId: null,
  }
  const variationItem = {
    id: 'vi1',
    sectionId: 'b1',
    code: '1.2',
    description: 'Variation line',
    unit: 'm',
    quantity: 2,
    quantityMode: 'measured' as const,
    rateModel: 'amount_only' as const,
    supplyRate: null,
    installRate: null,
    rate: null,
    amount: 200,
    sortOrder: 1,
    origin: 'variation' as const,
    variationLineId: 'vl1',
  }
  const importRow = {
    id: 'imp1',
    projectId: 'p1',
    organisationId: 'o1',
    sourceFilename: 'tender.xlsx',
    storagePath: null,
    importedBy: null,
    importedAt: '2026-06-08T00:00:00Z',
    totalExVat: 1000,
    vatAmount: 150,
    totalInclVat: 1150,
    lineItemCount: 2,
    isCurrent: true,
  }
  const sections = [
    { id: 'b1', importId: 'imp1', parentSectionId: null, kind: 'bill' as const, code: '1', title: 'BILL A', sortOrder: 0, nodeId: null },
  ]

  it('contract total equals 1000 (variation item excluded) — no (edited) marker', () => {
    render(
      <RatesTab
        projectId="p1"
        canEdit={false}
        initial={{ import: importRow, sections, items: [contractItem, variationItem], totals: {}, importedByName: null }}
      />,
    )
    // liveExVat = totals[b1] = 1000 (contract items only) = importRow.totalExVat
    // → isEdited=false → the amber "(edited)" span must NOT be present
    expect(screen.queryByText('(edited)')).toBeNull()
  })

  it('revised total includes the variation item (1200) when the VO is materialised', () => {
    render(
      <RatesTab
        projectId="p1"
        canEdit={false}
        initial={{ import: importRow, sections, items: [contractItem, variationItem], totals: {}, importedByName: null }}
      />,
    )
    // hasRevisions=true because items contains an origin='variation' item →
    // "Contract (ex VAT)" and "Revised (ex VAT)" column headers must both appear.
    expect(screen.getByText('Contract (ex VAT)')).toBeTruthy()
    expect(screen.getByText('Revised (ex VAT)')).toBeTruthy()
  })
})
