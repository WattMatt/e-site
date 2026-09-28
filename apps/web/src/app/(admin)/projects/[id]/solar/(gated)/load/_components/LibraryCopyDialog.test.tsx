import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ search: vi.fn(), link: vi.fn() }))
vi.mock('@/actions/solar-load.actions', () => ({ searchLibraryMetersAction: h.search, linkLibraryMetersAction: h.link }))
import { LibraryCopyDialog } from './LibraryCopyDialog'

beforeEach(() => {
  vi.clearAllMocks()
  h.search.mockResolvedValue({ ok: true, meters: [{ id: 'm7', label: 'Shop 7', siteLabel: 'YA', kind: 'tenant', serials: ['S7'] }] })
  h.link.mockResolvedValue({ ok: true, linked: 1 })
})

describe('LibraryCopyDialog', () => {
  it('searches the org library and links the chosen meters (a reference, no copy of data)', async () => {
    const onLinked = vi.fn()
    render(<LibraryCopyDialog projectId="p1" onClose={vi.fn()} onLinked={onLinked} />)
    await userEvent.type(screen.getByLabelText('Search the org meter library'), 'shop{enter}')
    expect(h.search).toHaveBeenCalledWith({ projectId: 'p1', query: 'shop' })
    await userEvent.click(await screen.findByLabelText(/Shop 7/))
    await userEvent.click(screen.getByRole('button', { name: 'Add 1 meter to this study' }))
    expect(h.link).toHaveBeenCalledWith({ projectId: 'p1', meterIds: ['m7'] })
    expect(onLinked).toHaveBeenCalledWith(1)
  })
})
