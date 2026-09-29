import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
const h = vi.hoisted(() => ({
  create: vi.fn(), save: vi.fn(), del: vi.fn(), revise: vi.fn(), issue: vi.fn(), withdraw: vi.fn(), link: vi.fn(), narrative: vi.fn(), refresh: vi.fn(),
}))
vi.mock('@/actions/solar-proposals.actions', () => ({
  createSolarProposalAction: h.create, saveSolarProposalDraftAction: h.save, deleteSolarProposalDraftAction: h.del,
  reviseSolarProposalAction: h.revise, issueSolarProposalAction: h.issue, withdrawSolarProposalAction: h.withdraw,
  newSolarProposalLinkAction: h.link, draftSolarProposalNarrativeAction: h.narrative,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { ProposalsPanel } from './ProposalsPanel'
import type { ProposalListItem } from '@/lib/solar/reports/page-data'

const draft = { clientName: 'Acme', marginPct: 0, validityDays: 30, financeOptions: ['cash' as const], summary: '', scope: '', priceTerms: '', assumptions: '', inclusions: [], exclusions: [], terms: '', narrative: '' }
const controls = (o: Partial<ProposalListItem['controls']> = {}) => ({ canEdit: false, canIssue: false, issueBlockedReason: null, canDelete: false, canWithdraw: false, canRotate: false, canRevise: false, ...o })
const item = (o: Partial<ProposalListItem>): ProposalListItem => ({
  id: 'd1', familyId: 'f1', version: 1, status: 'draft', effectiveStatus: 'draft', expiresAt: null, issuedAt: null, updatedAt: 'T0', draft, offerExclVat: null, controls: controls(), events: [], ...o,
})
const selected = { ok: true as const, caseId: 'c1', caseName: 'Base', runId: 'r1' }
const base = { projectId: 'p1', selected, clientContacts: [{ userId: 'cv1', name: 'Client Viewer', email: 'cv@acme.example' }], narrative: { available: true, reason: null }, emailEnabled: true }

beforeEach(() => vi.clearAllMocks())

describe('ProposalsPanel (§9.3)', () => {
  it('empty state with New proposal; disabled with the reason when no selected case', () => {
    const { rerender } = render(<ProposalsPanel {...base} proposals={[]} />)
    expect(screen.getByText('No proposals yet')).toBeTruthy()
    rerender(<ProposalsPanel {...base} selected={{ ok: false, stale: false, reason: 'Choose a selected case on the Overview first.' }} proposals={[]} />)
    const b = screen.getByRole('button', { name: 'New proposal' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.title).toBe('Choose a selected case on the Overview first.')
  })
  it('draft: edit and save with the stale guard; margin 0 is flagged; field errors shown', async () => {
    h.save.mockResolvedValueOnce({ fieldErrors: { clientName: 'Enter the client name' } }).mockResolvedValueOnce({ ok: true, updatedAt: 'T1' })
    render(<ProposalsPanel {...base} proposals={[item({ controls: controls({ canEdit: true, canIssue: true, canDelete: true }) })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft v1' }))
    expect(screen.getByText('Margin is 0 % — set one here, or a default margin on the org rate card.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Client name'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Enter the client name')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'Acme Retail' } })
    fireEvent.change(screen.getByLabelText('Inclusions (one per line)'), { target: { value: 'Monitoring\n\nCleaning' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(h.save).toHaveBeenLastCalledWith({ projectId: 'p1', proposalId: 'd1', expectedUpdatedAt: 'T0', draft: expect.objectContaining({ clientName: 'Acme Retail', inclusions: ['Monitoring', 'Cleaning'] }) }))
  })
  it('Preview PDF opens the preview route', () => {
    render(<ProposalsPanel {...base} proposals={[item({ controls: controls({ canEdit: true, canIssue: true }) })]} />)
    expect(screen.getByRole('link', { name: 'Preview PDF' }).getAttribute('href')).toBe('/api/projects/p1/solar/proposals/d1/preview')
  })
  it('New link is two-step and says the old link stops working (review M4)', async () => {
    h.link.mockResolvedValue({ ok: true, link: 'https://www.e-site.live/proposal/NEW' })
    render(<ProposalsPanel {...base} proposals={[item({ id: 'i0', status: 'issued', effectiveStatus: 'issued', controls: controls({ canRotate: true }) })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'New link for v1' }))
    expect(h.link).not.toHaveBeenCalled()
    const confirm = screen.getByRole('button', { name: 'Confirm new link for v1' })
    expect(confirm.textContent).toBe('Confirm new link — the old link stops working')
    fireEvent.click(confirm)
    await waitFor(() => expect(h.link).toHaveBeenCalledWith({ projectId: 'p1', proposalId: 'i0' }))
  })
  it('a successful New link clears the previous refusal, as every other control does (review round 2, M2)', async () => {
    h.link.mockResolvedValueOnce({ error: 'Too many requests — try again in a minute.' })
      .mockResolvedValueOnce({ ok: true, link: 'https://www.e-site.live/proposal/NEW' })
    render(<ProposalsPanel {...base} proposals={[item({ id: 'i0', status: 'issued', effectiveStatus: 'issued', controls: controls({ canRotate: true }) })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'New link for v1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm new link for v1' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Too many requests — try again in a minute.'))
    fireEvent.click(screen.getByRole('button', { name: 'New link for v1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm new link for v1' }))
    await waitFor(() => expect(h.link).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
  it('Preview PDF is disabled with the reason when the selected case is not usable (review M5)', () => {
    const reason = 'The selected case is stale — re-run it first.'
    render(<ProposalsPanel {...base} selected={{ ok: false, stale: true, reason }} proposals={[item({ controls: controls({ canEdit: true, canIssue: true }) })]} />)
    expect(screen.queryByRole('link', { name: 'Preview PDF' })).toBeNull()
    const b = screen.getByRole('button', { name: 'Preview PDF' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.title).toBe(reason)
  })
  it('a draft whose family has an accepted version shows Issue disabled with the reason (review I2)', () => {
    const reason = 'Another version of this proposal was accepted — it cannot be issued. Start a new proposal instead.'
    render(<ProposalsPanel {...base} proposals={[item({ controls: controls({ canEdit: true, canDelete: true, canIssue: false, issueBlockedReason: reason }) })]} />)
    const b = screen.getByRole('button', { name: 'Issue v1' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.title).toBe(reason)
    expect(screen.getByText(reason)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Preview PDF' })).toBeNull()
  })
  it('Issue is two-step, sends the chosen client ids, then shows the link ONCE with the email note', async () => {
    h.issue.mockResolvedValue({ ok: true, link: 'https://www.e-site.live/proposal/TOKEN', emailed: 0, emailNote: 'Solar emails are off for this project (Project settings, Integrations), so no email was sent.' })
    render(<ProposalsPanel {...base} proposals={[item({ controls: controls({ canIssue: true }) })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Issue v1' }))
    fireEvent.click(screen.getByLabelText('Email Client Viewer (cv@acme.example)'))
    const issue = screen.getByRole('button', { name: 'Issue proposal' })
    fireEvent.click(issue)
    expect(h.issue).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm issue' }))
    await waitFor(() => expect(h.issue).toHaveBeenCalledWith({ projectId: 'p1', proposalId: 'd1', expectedUpdatedAt: 'T0', emailClientUserIds: ['cv1'] }))
    expect((await screen.findByLabelText('Client link')) as HTMLInputElement).toHaveProperty('value', 'https://www.e-site.live/proposal/TOKEN')
    expect(screen.getByText(/shown once/)).toBeTruthy()
    expect(screen.getByText(/Solar emails are off/)).toBeTruthy()
  })
  it('email choices are disabled with the reason when the project toggle is off', () => {
    render(<ProposalsPanel {...base} emailEnabled={false} proposals={[item({ controls: controls({ canIssue: true }) })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Issue v1' }))
    expect((screen.getByLabelText('Email Client Viewer (cv@acme.example)') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('Solar emails are off for this project — turn them on under Project settings, Integrations.')).toBeTruthy()
  })
  it('issued: status chip, Withdraw two-step, New link, Revise', async () => {
    h.withdraw.mockResolvedValue({ ok: true })
    h.revise.mockResolvedValue({ ok: true, proposalId: 'd2', version: 2 })
    render(<ProposalsPanel {...base} proposals={[item({ id: 'i1', status: 'viewed', effectiveStatus: 'viewed', expiresAt: '2026-10-29T08:00:00Z', issuedAt: '2026-09-29T08:00:00Z', offerExclVat: 'R 1 150 000.00', controls: controls({ canWithdraw: true, canRotate: true, canRevise: true }) })]} />)
    expect(screen.getByText('Viewed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw v1' }))
    expect(h.withdraw).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdraw v1' }))
    await waitFor(() => expect(h.withdraw).toHaveBeenCalledWith({ projectId: 'p1', proposalId: 'i1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revise v1' }))
    await waitFor(() => expect(h.revise).toHaveBeenCalledWith({ projectId: 'p1', proposalId: 'i1' }))
    expect(screen.getByRole('button', { name: 'New link for v1' })).toBeTruthy()
  })
  it('acceptance record shows the stamped evidence', () => {
    render(<ProposalsPanel {...base} proposals={[item({ id: 'i1', status: 'accepted', effectiveStatus: 'accepted', events: [
      { kind: 'accepted', via: 'token', at: '2026-10-01T10:00:00Z', actorName: 'Client Name', actorEmail: 'c@acme.example', ip: '203.0.113.7', userAgent: 'agent', pdfSha256: 'a'.repeat(64), authority: true, reason: null, hasSignature: true },
    ] })]} />)
    const rec = screen.getByRole('table', { name: 'Acceptance record v1' })
    for (const t of ['Client Name', 'c@acme.example', '203.0.113.7', 'agent', 'a'.repeat(64), 'Yes', 'Signed']) expect(within(rec).getByText(t)).toBeTruthy()
  })
  it('Draft narrative: disabled with the reason when unavailable; inserts and keeps the saved text', async () => {
    const { rerender } = render(<ProposalsPanel {...base} narrative={{ available: false, reason: 'no key' }} proposals={[item({ controls: controls({ canEdit: true }) })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft v1' }))
    const b = screen.getByRole('button', { name: 'Draft narrative' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.title).toBe('no key')
    h.narrative.mockResolvedValue({ ok: true, narrative: 'Drafted text.', updatedAt: 'T9' })
    rerender(<ProposalsPanel {...base} proposals={[item({ controls: controls({ canEdit: true }) })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draft narrative' }))
    await waitFor(() => expect((screen.getByLabelText('About this proposal (narrative)') as HTMLTextAreaElement).value).toBe('Drafted text.'))
  })
  it('Delete draft is two-step; New link shows the replacement link once', async () => {
    h.del.mockResolvedValue({ ok: true })
    h.link.mockResolvedValue({ ok: true, link: 'https://www.e-site.live/proposal/NEW' })
    render(<ProposalsPanel {...base} proposals={[
      item({ controls: controls({ canEdit: true, canIssue: true, canDelete: true }) }),
      item({ id: 'i0', version: 1, familyId: 'f0', status: 'issued', effectiveStatus: 'issued', controls: controls({ canRotate: true }) }),
    ]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete draft v1' }))
    expect(h.del).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete draft v1' }))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith({ projectId: 'p1', proposalId: 'd1' }))
    fireEvent.click(screen.getByRole('button', { name: 'New link for v1' }))
    expect(h.link).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm new link for v1' }))
    await waitFor(() => expect(h.link).toHaveBeenCalledWith({ projectId: 'p1', proposalId: 'i0' }))
    expect((await screen.findByLabelText('Client link')) as HTMLInputElement).toHaveProperty('value', 'https://www.e-site.live/proposal/NEW')
  })
})
