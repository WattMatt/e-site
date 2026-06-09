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
