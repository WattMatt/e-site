import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ScopeItemsModal } from './ScopeItemsModal'
import { addScopeItemTypeAction, removeScopeItemTypeAction } from '@/actions/tenant-scope.actions'

vi.mock('@/actions/tenant-scope.actions', () => ({
  addScopeItemTypeAction: vi.fn(),
  removeScopeItemTypeAction: vi.fn(),
}))

const addMock = addScopeItemTypeAction as unknown as ReturnType<typeof vi.fn>
const removeMock = removeScopeItemTypeAction as unknown as ReturnType<typeof vi.fn>

const ITEMS = [
  { id: 't-db', key: 'db', label: 'DB', sort_order: 0 },
  { id: 't-light', key: 'lighting', label: 'Lighting', sort_order: 1 },
  { id: 't-sf', key: 'shopfront', label: 'Shopfront', sort_order: 5 },
]

function renderModal(over: Partial<React.ComponentProps<typeof ScopeItemsModal>> = {}) {
  const props = {
    projectId: 'p1',
    orgId: 'o1',
    orgName: 'WM Consulting',
    items: ITEMS,
    canManage: true,
    onClose: vi.fn(),
    onAdded: vi.fn(),
    onRemoved: vi.fn(),
    ...over,
  }
  render(<ScopeItemsModal {...props} />)
  return props
}

beforeEach(() => {
  addMock.mockReset()
  removeMock.mockReset()
})

describe('ScopeItemsModal — the org-wide effect is unmissable', () => {
  it('titles the add form for ALL tenants and names the organisation in the warning', () => {
    renderModal()
    expect(screen.getByRole('dialog', { name: 'Scope items' })).toBeTruthy()
    expect(screen.getByText('Add a scope item for ALL tenants')).toBeTruthy()
    expect(
      screen.getByText(
        /This adds a column for every tenant on every project in WM Consulting\. To note something for one shop, use that shop's scope documents or notes instead\./,
      ),
    ).toBeTruthy()
  })

  it('keeps Add disabled until the "applies to all projects" box is ticked', async () => {
    addMock.mockResolvedValue({ ok: true, id: 'new-id' })
    const props = renderModal()
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Power Points' } })
    const add = screen.getByRole('button', { name: /add item/i }) as HTMLButtonElement
    expect(add.disabled).toBe(true)

    // Submitting the form while unticked must not reach the action either.
    fireEvent.submit(add.closest('form') as HTMLFormElement)
    expect(addMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('I understand this applies to all projects'))
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    await waitFor(() => expect(addMock).toHaveBeenCalledWith('p1', 'o1', 'power_points', 'Power Points'))
    await waitFor(() => expect(props.onAdded).toHaveBeenCalledWith('new-id', 'power_points', 'Power Points'))
  })

  it('shows the action\'s refusal sentence when the add is refused', async () => {
    addMock.mockResolvedValue({ error: '"DB" already exists as a scope item.' })
    const props = renderModal()
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'DB' } })
    fireEvent.click(screen.getByLabelText('I understand this applies to all projects'))
    fireEvent.click(screen.getByRole('button', { name: /add item/i }))
    expect(await screen.findByText('"DB" already exists as a scope item.')).toBeTruthy()
    expect(props.onAdded).not.toHaveBeenCalled()
  })
})

describe('ScopeItemsModal — removing an item', () => {
  it('lists every current item and offers Remove only on non-built-in ones', () => {
    renderModal()
    const list = screen.getByRole('list', { name: 'Current scope items' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('DB'),
      expect.stringContaining('Lighting'),
      expect.stringContaining('Shopfront'),
    ])
    expect(within(rows[0]).queryByRole('button', { name: /remove/i })).toBeNull()
    expect(within(rows[1]).queryByRole('button', { name: /remove/i })).toBeNull()
    expect(within(rows[2]).getByRole('button', { name: 'Remove Shopfront' })).toBeTruthy()
  })

  it('needs two presses: the first arms, only the second calls the action', async () => {
    removeMock.mockResolvedValue({ ok: true })
    const props = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Shopfront' }))
    expect(removeMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove Shopfront' }))
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('p1', 'o1', 't-sf'))
    await waitFor(() => expect(props.onRemoved).toHaveBeenCalledWith('t-sf'))
  })

  it('shows the refusal sentence when the item is in use, and keeps it listed', async () => {
    removeMock.mockResolvedValue({ error: 'Used by 3 tenants and 2 order lines — clear those first.' })
    const props = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Shopfront' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove Shopfront' }))
    expect(await screen.findByText('Used by 3 tenants and 2 order lines — clear those first.')).toBeTruthy()
    expect(props.onRemoved).not.toHaveBeenCalled()
  })

  it('hides Remove and the add form from a viewer without an org write role', () => {
    renderModal({ canManage: false })
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
    expect(screen.queryByLabelText('Label')).toBeNull()
    expect(screen.getByRole('list', { name: 'Current scope items' })).toBeTruthy()
  })
})
