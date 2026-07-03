import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockUpdate, mockRefresh } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockRefresh: vi.fn(),
}))

vi.mock('@/actions/tenant-entry.actions', () => ({
  updateTenantEntryAction: (...args: unknown[]) => mockUpdate(...args),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}))

import { TenantEditModal } from './TenantEditModal'

const node = {
  id: 'node-1',
  code: 'DB-23',
  shop_number: '23',
  shop_name: 'PEP HOME',
  name: 'PEP HOME',
  shop_area_m2: 180,
}

describe('TenantEditModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefills the form from the tenant entry and shows the immutable DB code', () => {
    render(<TenantEditModal projectId="p-1" node={node} onClose={() => {}} />)

    expect((screen.getByLabelText(/SHOP NO/i) as HTMLInputElement).value).toBe('23')
    expect((screen.getByLabelText(/Tenant name/i) as HTMLInputElement).value).toBe('PEP HOME')
    expect((screen.getByLabelText(/GLA/i) as HTMLInputElement).value).toBe('180')
    // The DB code is context, not an input
    expect(screen.getByText('DB-23')).toBeTruthy()
  })

  it('falls back to node.name when shop_name is null', () => {
    render(
      <TenantEditModal
        projectId="p-1"
        node={{ ...node, shop_name: null, name: 'LINE SHOP' }}
        onClose={() => {}}
      />,
    )
    expect((screen.getByLabelText(/Tenant name/i) as HTMLInputElement).value).toBe('LINE SHOP')
  })

  it('saves trimmed values, closes, and refreshes on success', async () => {
    mockUpdate.mockResolvedValue({ ok: true })
    const onClose = vi.fn()
    render(<TenantEditModal projectId="p-1" node={node} onClose={onClose} />)

    const name = screen.getByLabelText(/Tenant name/i)
    await userEvent.clear(name)
    await userEvent.type(name, '  PEP HOME NEW  ')

    const area = screen.getByLabelText(/GLA/i)
    await userEvent.clear(area)
    await userEvent.type(area, '210.5')

    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('p-1', 'node-1', {
        shopNumber: '23',
        shopName: 'PEP HOME NEW',
        shopAreaM2: 210.5,
      })
      expect(onClose).toHaveBeenCalled()
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('sends null name and null area when the fields are blank (area pending)', async () => {
    mockUpdate.mockResolvedValue({ ok: true })
    render(<TenantEditModal projectId="p-1" node={node} onClose={() => {}} />)

    await userEvent.clear(screen.getByLabelText(/Tenant name/i))
    await userEvent.clear(screen.getByLabelText(/GLA/i))
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('p-1', 'node-1', {
        shopNumber: '23',
        shopName: null,
        shopAreaM2: null,
      })
    })
  })

  it('blocks saving with a blank SHOP NO.', async () => {
    render(<TenantEditModal projectId="p-1" node={node} onClose={() => {}} />)

    await userEvent.clear(screen.getByLabelText(/SHOP NO/i))
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(screen.getByText(/SHOP NO\. is required/i)).toBeTruthy()
  })

  it('blocks saving a non-numeric GLA', async () => {
    render(<TenantEditModal projectId="p-1" node={node} onClose={() => {}} />)

    const area = screen.getByLabelText(/GLA/i)
    await userEvent.clear(area)
    await userEvent.type(area, 'about 200')
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(screen.getByText(/must be a number/i)).toBeTruthy()
  })

  it('warns about re-import matching when the SHOP NO. is changed', async () => {
    render(<TenantEditModal projectId="p-1" node={node} onClose={() => {}} />)

    // No warning while untouched
    expect(screen.queryByText(/Re-imports match tenants by SHOP NO/i)).toBeNull()

    const num = screen.getByLabelText(/SHOP NO/i)
    await userEvent.clear(num)
    await userEvent.type(num, 'R1')

    expect(screen.getByText(/Re-imports match tenants by SHOP NO/i)).toBeTruthy()
  })

  it('renders the action error inline and stays open', async () => {
    mockUpdate.mockResolvedValue({ error: 'SHOP NO. "R1" is already used by another tenant.' })
    const onClose = vi.fn()
    render(<TenantEditModal projectId="p-1" node={node} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('already used')
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
