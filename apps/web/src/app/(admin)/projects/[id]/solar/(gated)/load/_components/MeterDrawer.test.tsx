import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ update: vi.fn(), remove: vi.fn(), parse: vi.fn() }))
vi.mock('@/actions/solar-load.actions', () => ({ updateStudyMeterAction: h.update, removeStudyMeterAction: h.remove }))
vi.mock('@/lib/solar/load/import-client', async (orig) => ({ ...(await orig<object>()), parseFiles: h.parse }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('./MeterSeriesChart', () => ({ MeterSeriesChart: () => <div>chart</div> }))
import { MeterDrawer } from './MeterDrawer'
import type { MeterView } from '@/lib/solar/load/view-types'

const meter: MeterView = {
  id: 'm1', label: 'Bulk', kind: 'bulk', siteLabel: 'YA', serials: [], nodeId: null, tenantLabel: null, shopNo: null, areaM2: null,
  supplyPointConfirmed: false, updatedAt: 'M0', primaryChannelId: 'c1', intervalMin: 30, periodStart: null, periodEnd: null,
  completeness: 0.99, peakKw: 400, annualKwh: 1_000_000, fileIds: ['f1'], otherStudyLinks: 0, status: 'imported',
}
const base = { projectId: 'p1', canEdit: true, isGrantor: true, bulkRecon: [], onClose: vi.fn(), onEditMapping: vi.fn() }
beforeEach(() => {
  vi.clearAllMocks()
  h.update.mockResolvedValue({ ok: true, updatedAt: 'M1' })
  h.remove.mockResolvedValue({ ok: true, deletedFromLibrary: false })
  h.parse.mockResolvedValue({ reviews: [{ fileId: 'f1' }], failed: [] })
})

describe('MeterDrawer', () => {
  it('confirming the point of supply is offered for a bulk meter and saved on the loaded version', async () => {
    render(<MeterDrawer meter={meter} {...base} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }))
    await userEvent.click(screen.getByLabelText(/This meter is the point of supply/))
    await userEvent.click(screen.getByRole('button', { name: 'Save meter' }))
    expect(h.update).toHaveBeenCalledWith({ projectId: 'p1', meterId: 'm1', patch: { supplyPointConfirmed: true }, expectedUpdatedAt: 'M0' })
  })
  it('the tenant is shown from the load basis with the way to change it — no second write path (LS-02)', async () => {
    render(<MeterDrawer {...base} meter={{ ...meter, kind: 'tenant', nodeId: 'n1', tenantLabel: '12 · Pep' }} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }))
    expect(screen.queryByLabelText(/Link to tenant/)).toBeNull()
    expect(screen.getByText(/Tenant: 12 · Pep/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Change it on the Tenants tab' }).getAttribute('href')).toContain('tenants')
  })
  it('remove is two-step; a grantor may also delete from the library', async () => {
    render(<MeterDrawer meter={meter} {...base} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }))
    await userEvent.click(screen.getByLabelText('Also delete from library'))
    await userEvent.click(screen.getByRole('button', { name: 'Remove from study' }))
    expect(h.remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))
    expect(h.remove).toHaveBeenCalledWith({ projectId: 'p1', meterId: 'm1', alsoDeleteFromLibrary: true })
  })
  it('a removal with a note (kept in the library) closes the drawer and hands the note to the list', async () => {
    h.remove.mockResolvedValueOnce({ ok: true, deletedFromLibrary: false, note: 'Removed from this study; the meter is still used by another study, so it stays in the library.' })
    const onClose = vi.fn()
    const onRemoved = vi.fn()
    render(<MeterDrawer meter={meter} {...base} onClose={onClose} onRemoved={onRemoved} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove from study' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))
    expect(onRemoved).toHaveBeenCalledWith('Removed from this study; the meter is still used by another study, so it stays in the library.')
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('edit mapping re-parses the meter’s files for the review dialog', async () => {
    render(<MeterDrawer meter={meter} {...base} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }))
    await userEvent.click(screen.getByRole('button', { name: 'Edit mapping' }))
    expect(h.parse).toHaveBeenCalledWith('p1', ['f1'])
    expect(base.onEditMapping).toHaveBeenCalledWith([{ fileId: 'f1' }], 'm1')
  })
  it('View level: chart, heatmap and CSV only', async () => {
    render(<MeterDrawer meter={meter} {...base} canEdit={false} />)
    expect(screen.getByRole('link', { name: 'Download normalised CSV' }).getAttribute('href')).toBe('/api/projects/p1/solar/meters/m1/csv')
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }))
    expect(screen.queryByRole('button', { name: 'Remove from study' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save meter' })).toBeNull()
  })
})
