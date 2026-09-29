import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EMPTY_SITE_SUPPLY_FORM } from '@esite/shared'

const h = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-site.actions', () => ({ saveSolarSiteAction: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))

import { SiteSupplyForm, type SiteSupplyFormProps } from './SiteSupplyForm'
import { isSolarDirty, setSolarDirty } from '@/lib/solar/dirty-store'

const props: SiteSupplyFormProps = {
  projectId: 'p1',
  initialForm: { ...EMPTY_SITE_SUPPLY_FORM },
  updatedAt: null,
  canEdit: true,
  address: '1 Main Rd, Pretoria, Gauteng',
  nodes: [
    { id: 'n1', label: 'MB-1 — Main board', kind: 'main_board', ratingKva: 1000 },
    { id: 'n2', label: 'RMU-1', kind: 'rmu', ratingKva: null },
  ],
  nmdPrefill: { value: '1000', from: 'MB-1 — Main board' },
}

beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, updatedAt: 'T1' }) })
afterEach(() => { setSolarDirty(false) })

describe('SiteSupplyForm', () => {
  it('shows the project address read-only with a link to project settings', () => {
    render(<SiteSupplyForm {...props} />)
    expect(screen.getByText('1 Main Rd, Pretoria, Gauteng')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Edit in project settings' }).getAttribute('href')).toBe('/projects/p1/settings/site')
  })

  it('pre-fills NMD from the main incomer and says where it came from', () => {
    render(<SiteSupplyForm {...props} />)
    expect((screen.getByLabelText('Notified maximum demand (NMD, kVA)') as HTMLInputElement).value).toBe('1000')
    expect(screen.getByText('Pre-filled from MB-1 — Main board')).toBeDefined()
  })

  it('an invalid latitude shows the error and does not call the server', async () => {
    const user = userEvent.setup()
    render(<SiteSupplyForm {...props} />)
    await user.type(screen.getByLabelText('Latitude'), '-95')
    await user.type(screen.getByLabelText('Longitude'), '28')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Latitude must be between -90 and 90')).toBeDefined()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('outside South Africa warns but still saves', async () => {
    const user = userEvent.setup()
    render(<SiteSupplyForm {...props} />)
    await user.type(screen.getByLabelText('Latitude'), '26')
    await user.type(screen.getByLabelText('Longitude'), '28')
    expect(screen.getByText(/outside South Africa/)).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1', expectedUpdatedAt: null,
      form: expect.objectContaining({ latitude: '26', longitude: '28', nmdKva: '1000' }),
    }))
    expect(await screen.findByText('Saved')).toBeDefined()
    expect(h.refresh).toHaveBeenCalled()
  })

  it('sends the new updated_at on the next save', async () => {
    const user = userEvent.setup()
    render(<SiteSupplyForm {...props} />)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    await user.type(screen.getByLabelText('Supply authority'), 'City Power')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: 'T1' }))
  })

  it('shows the stale sentence', async () => {
    h.save.mockResolvedValueOnce({ error: 'Someone else changed this — reload to see their version.' })
    render(<SiteSupplyForm {...props} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Someone else changed this — reload to see their version.')).toBeDefined()
  })

  it('export limit appears only when export is allowed', async () => {
    const user = userEvent.setup()
    render(<SiteSupplyForm {...props} />)
    expect(screen.queryByLabelText('Export limit (kW)')).toBeNull()
    await user.selectOptions(screen.getByLabelText('Export allowed?'), 'net_billing')
    expect(screen.getByLabelText('Export limit (kW)')).toBeDefined()
    await user.selectOptions(screen.getByLabelText('Export allowed?'), 'zero_export')
    expect(screen.queryByLabelText('Export limit (kW)')).toBeNull()
  })

  it('supply voltage "Other" reveals a volts input', async () => {
    const user = userEvent.setup()
    render(<SiteSupplyForm {...props} />)
    await user.selectOptions(screen.getByLabelText('Supply voltage'), 'other')
    await user.type(screen.getByLabelText('Supply voltage (V)'), '6600')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ form: expect.objectContaining({ supplyVoltageV: '6600' }) }))
  })

  it('picking the point of connection shows that board’s rating', async () => {
    const user = userEvent.setup()
    render(<SiteSupplyForm {...props} />)
    await user.selectOptions(screen.getByLabelText('Point of connection'), 'n1')
    expect(screen.getByText('Transformer / mini-sub rating: 1000 kVA')).toBeDefined()
  })

  it('editing marks the page dirty for the tab bar guard', async () => {
    render(<SiteSupplyForm {...props} />)
    expect(isSolarDirty()).toBe(false)
    await userEvent.setup().type(screen.getByLabelText('Supply authority'), 'X')
    expect(isSolarDirty()).toBe(true)
  })

  it('View level: values as text, no inputs, no Save', () => {
    render(<SiteSupplyForm {...props} canEdit={false} initialForm={{ ...EMPTY_SITE_SUPPLY_FORM, latitude: '-26.1', longitude: '28.05', licenseeName: 'City Power' }} />)
    expect(screen.getByText('City Power')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByLabelText('Latitude')).toBeNull()
  })

  it('marks roof sources and solar resource as coming in a later phase', () => {
    render(<SiteSupplyForm {...props} />)
    expect(screen.getByText('Roof sources — coming in a later phase')).toBeDefined()
    expect(screen.getByText('Solar resource — coming in a later phase')).toBeDefined()
  })
})
