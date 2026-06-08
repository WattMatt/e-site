import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TenantDeleteModal } from './TenantDeleteModal'
import { getTenantDeleteSummaryAction, hardDeleteTenantAction } from '@/actions/tenant-delete.actions'

vi.mock('@/actions/tenant-delete.actions', () => ({
  getTenantDeleteSummaryAction: vi.fn(),
  hardDeleteTenantAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const summaryMock = getTenantDeleteSummaryAction as unknown as ReturnType<typeof vi.fn>
const deleteMock = hardDeleteTenantAction as unknown as ReturnType<typeof vi.fn>

const OK_SUMMARY = {
  ok: true as const,
  code: 'SHOP-12',
  name: 'Shoprite',
  counts: {
    scopeItems: 1, documents: 0, documentRevisions: 0, units: 0, orders: 0,
    shopDrawings: 0, orderDocuments: 0, cableSupplies: 0, inspectionsTargeting: 0, storageFiles: 0,
  },
}

beforeEach(() => {
  summaryMock.mockReset()
  deleteMock.mockReset()
})

describe('TenantDeleteModal — type-to-confirm', () => {
  it('keeps "Delete permanently" disabled until the exact board code is typed', async () => {
    summaryMock.mockResolvedValue(OK_SUMMARY)
    render(<TenantDeleteModal projectId="p" nodeId="n" code="SHOP-12" onClose={() => {}} />)

    const btn = (await screen.findByRole('button', { name: /delete permanently/i })) as HTMLButtonElement
    expect(btn.disabled).toBe(true)

    const input = screen.getByLabelText(/type .* to confirm/i)
    fireEvent.change(input, { target: { value: 'SHOP-1' } }) // close but wrong
    expect(btn.disabled).toBe(true)

    fireEvent.change(input, { target: { value: 'SHOP-12' } }) // exact match
    expect(btn.disabled).toBe(false)
  })

  it('does not call hardDeleteTenantAction while the confirm text is wrong (disabled button)', async () => {
    summaryMock.mockResolvedValue(OK_SUMMARY)
    render(<TenantDeleteModal projectId="p" nodeId="n" code="SHOP-12" onClose={() => {}} />)

    const btn = await screen.findByRole('button', { name: /delete permanently/i })
    fireEvent.click(btn) // disabled → React onClick must not fire
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('does not render the confirm input when the delete is blocked', async () => {
    summaryMock.mockResolvedValue({ blocked: true as const, reason: 'wired into an issued cable revision' })
    render(<TenantDeleteModal projectId="p" nodeId="n" code="SHOP-12" onClose={() => {}} />)

    expect(await screen.findByText(/issued cable revision/i)).toBeTruthy()
    expect(screen.queryByLabelText(/type .* to confirm/i)).toBeNull()
  })
})
