import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ confirm: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/actions/solar-load.actions', () => ({ confirmRegisterRowAction: h.confirm }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
import { RegisterPanel } from './RegisterPanel'

const rows = [
  { id: 'r1', siteLabel: 'YA', fileName: 'a.csv', tenantName: 'Pep', shopNo: '12', areaM2: 120, matchMethod: 'llm', confirmed: false, fileImported: true },
  { id: 'r2', siteLabel: 'YA', fileName: 'b.csv', tenantName: 'Mr P', shopNo: '13', areaM2: null, matchMethod: 'exact', confirmed: false, fileImported: false },
]
beforeEach(() => vi.clearAllMocks())

describe('RegisterPanel', () => {
  it('marks LLM rows unconfirmed with a Confirm button, and files not yet imported', async () => {
    render(<RegisterPanel projectId="p1" rows={rows} canEdit />)
    expect(screen.getAllByRole('button', { name: /Confirm/ })).toHaveLength(1)
    expect(screen.getByText('file not yet imported')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Pep' }))
    expect(h.confirm).toHaveBeenCalledWith({ projectId: 'p1', rowId: 'r1' })
  })
  it('View users get no Confirm', () => {
    render(<RegisterPanel projectId="p1" rows={rows} canEdit={false} />)
    expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull()
  })
})
