import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ link: vi.fn(async () => ({ ok: true })), na: vi.fn(async () => ({ ok: true })), sync: vi.fn(async () => ({ ok: true, added: 2 })), refresh: vi.fn() }))
vi.mock('@/actions/solar-handover.actions', () => ({ linkHandoverDocumentAction: h.link, setHandoverNotApplicableAction: h.na, syncHandoverItemsAction: h.sync }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { HandoverChecklist } from './HandoverChecklist'

const item = (over: Record<string, unknown>) => ({ id: 'h1', key: 'coc', label: 'Certificate of Compliance (CoC)', required: true, sortOrder: 0, documentId: null, documentName: null,
  notApplicable: false, note: null, completedAt: null, updatedAt: 'U', ...over })
const handover = {
  items: [item({}), item({ id: 'h2', key: 'om_manual', label: 'O&M manual', documentId: 'd2', documentName: 'OM.pdf', completedAt: 'C' })],
  completion: { done: 1, total: 2, pct: 50, requiredDone: 1, requiredTotal: 2 },
  documents: [{ id: 'd1', name: 'CoC.pdf' }, { id: 'd2', name: 'OM.pdf' }],
  templateName: 'Solar PV Handover',
}
beforeEach(() => vi.clearAllMocks())

describe('HandoverChecklist', () => {
  it('shows completion and links a Documents file to an item', async () => {
    render(<HandoverChecklist projectId="p1" installationId="i1" canEdit handover={handover} />)
    expect(screen.getByText('1 of 2 items (50 %) · 1 of 2 required')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Document for Certificate of Compliance (CoC)'), { target: { value: 'd1' } })
    await waitFor(() => expect(h.link).toHaveBeenCalledWith({ projectId: 'p1', itemId: 'h1', documentId: 'd1' }))
    expect(screen.getByRole('link', { name: 'Upload to Documents' }).getAttribute('href')).toBe('/projects/p1/documents')
  })
  it('marks an item N/A and adds missing template items', async () => {
    render(<HandoverChecklist projectId="p1" installationId="i1" canEdit handover={handover} />)
    fireEvent.click(screen.getByLabelText('Certificate of Compliance (CoC) not applicable'))
    await waitFor(() => expect(h.na).toHaveBeenCalledWith({ projectId: 'p1', itemId: 'h1', notApplicable: true, note: '' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add missing items from the template' }))
    await waitFor(() => expect(h.sync).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1' }))
  })
  it('View level shows linked file names only', () => {
    render(<HandoverChecklist projectId="p1" installationId="i1" canEdit={false} handover={handover} />)
    expect(screen.getByText('OM.pdf')).toBeTruthy()
    expect(screen.queryByLabelText('Document for Certificate of Compliance (CoC)')).toBeNull()
  })
})
