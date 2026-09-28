import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  setLevel: vi.fn(),
  decide: vi.fn(),
  copy: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/actions/solar-access.actions', () => ({
  setSolarMemberLevelAction: h.setLevel,
  decideSolarRequestAction: h.decide,
  copySolarAccessFromProjectAction: h.copy,
}))

import { AccessPanel } from './AccessPanel'
import type { AccessPanelData } from '@/lib/solar/access-panel-types'

const T1 = '2026-09-28T08:00:00.000000+00:00'
const data: AccessPanelData = {
  projectId: 'p1',
  projectName: 'Kings Mall',
  organisationId: 'org-1',
  members: [
    { userId: 'u-own', name: 'Olive Owner', email: 'o@x.test', role: 'owner', external: false, implicit: true, level: 'edit_financials', grantedByName: null, grantedAt: null, updatedAt: null },
    { userId: 'u-con', name: 'Carl Contractor', email: 'c@x.test', role: 'contractor', external: false, implicit: false, level: 'view', grantedByName: 'Olive Owner', grantedAt: T1, updatedAt: T1 },
    { userId: 'u-ext', name: 'Eve External', email: 'e@x.test', role: 'contractor', external: true, implicit: false, level: null, grantedByName: null, grantedAt: null, updatedAt: null },
  ],
  requests: [
    { id: 'r1', requesterId: 'u-req', requesterName: 'Rita Requester', requestedLevel: 'edit', maxLevel: 'edit_financials', note: 'For the PV design', createdAt: T1 },
  ],
  otherProjects: [{ id: 'p2', name: 'Other Mall' }],
  subscription: { status: 'active', currentPeriodEnd: '2027-09-28T08:00:00Z' },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.setLevel.mockResolvedValue({ ok: true, updatedAt: 'T2' })
  h.decide.mockResolvedValue({ ok: true })
  h.copy.mockResolvedValue({ ok: true, copied: 2, skipped: 1 })
})

describe('AccessPanel', () => {
  it('shows owners/admins as implicit Edit + financials, with no control', () => {
    render(<AccessPanel data={data} />)
    expect(screen.getByText('Edit + financials (owner/admin)')).toBeDefined()
    expect(screen.queryByLabelText('Solar level for Olive Owner')).toBeNull()
  })

  it('saves a level change immediately with the row’s expectedUpdatedAt', async () => {
    render(<AccessPanel data={data} />)
    await userEvent.setup().selectOptions(screen.getByLabelText('Solar level for Carl Contractor'), 'edit')
    expect(h.setLevel).toHaveBeenCalledWith({ projectId: 'p1', userId: 'u-con', level: 'edit', expectedUpdatedAt: T1 })
    expect(h.refresh).toHaveBeenCalled()
  })

  it('removing access needs a second press', async () => {
    const user = userEvent.setup()
    render(<AccessPanel data={data} />)
    await user.selectOptions(screen.getByLabelText('Solar level for Carl Contractor'), 'none')
    expect(h.setLevel).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(h.setLevel).toHaveBeenCalledWith({ projectId: 'p1', userId: 'u-con', level: null, expectedUpdatedAt: T1 })
  })

  it('an external member can only be given View', () => {
    render(<AccessPanel data={data} />)
    const select = screen.getByLabelText('Solar level for Eve External') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['None', 'View'])
  })

  it('shows a stale save as the reload sentence', async () => {
    h.setLevel.mockResolvedValueOnce({ error: 'Someone else changed this — reload to see their version.' })
    render(<AccessPanel data={data} />)
    await userEvent.setup().selectOptions(screen.getByLabelText('Solar level for Carl Contractor'), 'edit')
    expect((await screen.findByRole('alert')).textContent).toBe('Someone else changed this — reload to see their version.')
  })

  it('approves a request at the chosen level', async () => {
    const user = userEvent.setup()
    render(<AccessPanel data={data} />)
    expect(screen.getByText('“For the PV design”')).toBeDefined()
    await user.selectOptions(screen.getByLabelText('Approve Rita Requester as'), 'view')
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(h.decide).toHaveBeenCalledWith({ requestId: 'r1', decision: 'approve', level: 'view' })
  })

  it('declines with an optional reason', async () => {
    const user = userEvent.setup()
    render(<AccessPanel data={data} />)
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    await user.type(screen.getByLabelText('Reason (optional)'), 'Not on this job')
    await user.click(screen.getByRole('button', { name: 'Confirm decline' }))
    expect(h.decide).toHaveBeenCalledWith({ requestId: 'r1', decision: 'decline', reason: 'Not on this job' })
  })

  it('copy access needs two presses and reports the counts', async () => {
    const user = userEvent.setup()
    render(<AccessPanel data={data} />)
    await user.click(screen.getByRole('button', { name: 'Copy access from project' }))
    expect(h.copy).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Press again to copy from Other Mall' }))
    expect(h.copy).toHaveBeenCalledWith({ projectId: 'p1', sourceProjectId: 'p2' })
    expect(await screen.findByText('Copied 2; skipped 1 not eligible on this project.')).toBeDefined()
  })

  it('shows the subscription state and a Manage subscription link', () => {
    render(<AccessPanel data={data} />)
    expect(screen.getByText('Subscription')).toBeDefined()
    expect(screen.getByText('Active — renews 28 Sep 2027')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Manage subscription' }).getAttribute('href')).toBe('/settings/billing')
  })

  it('a cancelled-mid-year subscription stays active until the paid year ends (1B: non_renewing)', () => {
    render(<AccessPanel data={{ ...data, subscription: { status: 'non_renewing', currentPeriodEnd: '2027-09-28T08:00:00Z' } }} />)
    expect(screen.getByText('Active — ends 28 Sep 2027')).toBeDefined()
  })

  it('empty states', () => {
    render(<AccessPanel data={{ ...data, members: [], requests: [], otherProjects: [], subscription: null }} />)
    expect(screen.getByText('No requests waiting.')).toBeDefined()
    expect(screen.getByText('No project members yet — add them in project settings.')).toBeDefined()
    expect(screen.getByText('No other projects in this organisation.')).toBeDefined()
    expect(screen.getByText('Not subscribed')).toBeDefined()
  })
})
