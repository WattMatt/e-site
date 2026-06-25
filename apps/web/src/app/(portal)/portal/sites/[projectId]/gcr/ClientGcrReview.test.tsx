import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ClientGcrReview } from './ClientGcrReview'
import type { ClientGcrReviewPayload } from '@esite/shared'

const submitMock = vi.fn().mockResolvedValue({ ok: true, submitted: 1 })
vi.mock('../../../../portal-gcr.actions', () => ({
  submitGcrChangeRequestsAction: (...a: any[]) => submitMock(...a),
}))

const payload: ClientGcrReviewPayload = {
  tenants: [
    { shopNumber: 'S1', shopName: 'Shop One', areaM2: 100, participation: 'shared', loadingKw: 3, portionPercent: 60, monthly: 25200, ratePerSqm: 252 },
    { shopNumber: 'S2', shopName: 'Shop Two', areaM2: 50, participation: 'shared', loadingKw: 2, portionPercent: 40, monthly: 16800, ratePerSqm: 336 },
  ],
  banks: [{ zoneName: 'Bank A', installedKva: 500, utilisationPercent: 50 }],
  scheme: { monthlyCapitalRepayment: 42000, finalTariff: 3.85 },
}

const nodeIdByShop = { S1: 'node-1', S2: 'node-2' }

beforeEach(() => {
  submitMock.mockClear()
})

describe('ClientGcrReview', () => {
  it('renders outputs only — never a contractor cost-input field', () => {
    render(<ClientGcrReview projectId="p1" payload={payload} nodeIdByShop={nodeIdByShop} />)
    expect(screen.getByText('Shop One')).toBeTruthy()
    expect(screen.getByText('Bank A')).toBeTruthy()
    // contractor terms must NEVER appear anywhere on the client view
    expect(screen.queryByText(/capital cost/i)).toBeNull()
    expect(screen.queryByText(/diesel/i)).toBeNull()
    expect(screen.queryByText(/maintenance/i)).toBeNull()
    expect(screen.queryByText(/generator cost/i)).toBeNull()
    expect(screen.queryByText(/margin/i)).toBeNull()
  })

  it('renders the installed kVA + utilisation per bank', () => {
    render(<ClientGcrReview projectId="p1" payload={payload} nodeIdByShop={nodeIdByShop} />)
    expect(screen.getByText(/500/)).toBeTruthy()
    expect(screen.getByText(/50%/)).toBeTruthy()
  })

  it('formats monthly cost as ZAR', () => {
    render(<ClientGcrReview projectId="p1" payload={payload} nodeIdByShop={nodeIdByShop} />)
    // en-ZA currency uses a space group separator and R symbol
    expect(screen.getByText(/R\s?25\s?200/)).toBeTruthy()
  })

  it('shows a read-only requests banner', () => {
    render(<ClientGcrReview projectId="p1" payload={payload} nodeIdByShop={nodeIdByShop} />)
    expect(screen.getByText(/nothing is saved/i)).toBeTruthy()
  })

  it('captures an old→new proposal and submits the batch', async () => {
    render(<ClientGcrReview projectId="p1" payload={payload} nodeIdByShop={nodeIdByShop} />)
    const select = screen.getByLabelText('participation-S1') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'own' } })
    // the captured proposal is surfaced as old -> new on that row
    expect(screen.getByText(/shared\s*→\s*own/i)).toBeTruthy()
    fireEvent.click(screen.getByText(/submit/i))
    await waitFor(() => expect(submitMock).toHaveBeenCalled())
    expect(submitMock).toHaveBeenCalledWith('p1', [
      expect.objectContaining({ nodeId: 'node-1', field: 'participation', oldValue: 'shared', newValue: 'own' }),
    ])
  })

  it('captures an area override proposal', async () => {
    render(<ClientGcrReview projectId="p1" payload={payload} nodeIdByShop={nodeIdByShop} />)
    const areaInput = screen.getByLabelText('area-S2') as HTMLInputElement
    fireEvent.change(areaInput, { target: { value: '75' } })
    fireEvent.click(screen.getByText(/submit/i))
    await waitFor(() => expect(submitMock).toHaveBeenCalled())
    expect(submitMock).toHaveBeenCalledWith('p1', [
      expect.objectContaining({ nodeId: 'node-2', field: 'area', oldValue: '50', newValue: '75' }),
    ])
  })

  it('attaches a per-tenant comment to the captured proposal', async () => {
    render(<ClientGcrReview projectId="p1" payload={payload} nodeIdByShop={nodeIdByShop} />)
    fireEvent.change(screen.getByLabelText('participation-S1'), { target: { value: 'none' } })
    fireEvent.change(screen.getByLabelText('comment-S1'), { target: { value: 'we opt out' } })
    fireEvent.click(screen.getByText(/submit/i))
    await waitFor(() => expect(submitMock).toHaveBeenCalled())
    expect(submitMock).toHaveBeenCalledWith('p1', [
      expect.objectContaining({ field: 'participation', newValue: 'none', comment: 'we opt out' }),
    ])
  })

  it('does not submit when nothing was changed', () => {
    render(<ClientGcrReview projectId="p1" payload={payload} nodeIdByShop={nodeIdByShop} />)
    fireEvent.click(screen.getByText(/submit/i))
    expect(submitMock).not.toHaveBeenCalled()
  })

  it('reverting an edit back to the original drops the captured proposal', () => {
    render(<ClientGcrReview projectId="p1" payload={payload} nodeIdByShop={nodeIdByShop} />)
    const select = screen.getByLabelText('participation-S1') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'own' } })
    expect(screen.queryByText(/shared\s*→\s*own/i)).toBeTruthy()
    fireEvent.change(select, { target: { value: 'shared' } })
    expect(screen.queryByText(/shared\s*→\s*own/i)).toBeNull()
    fireEvent.click(screen.getByText(/submit/i))
    expect(submitMock).not.toHaveBeenCalled()
  })

  it('confirms success and clears local state after submit', async () => {
    render(<ClientGcrReview projectId="p1" payload={payload} nodeIdByShop={nodeIdByShop} />)
    fireEvent.change(screen.getByLabelText('participation-S1'), { target: { value: 'own' } })
    fireEvent.click(screen.getByText(/submit/i))
    await waitFor(() => expect(screen.getByText(/submitted/i)).toBeTruthy())
    // captured proposal cleared after a successful submit
    expect(screen.queryByText(/shared\s*→\s*own/i)).toBeNull()
  })
})
