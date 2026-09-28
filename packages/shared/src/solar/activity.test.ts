import { describe, it, expect } from 'vitest'
import { describeSolarAuditEvent } from './activity'

describe('describeSolarAuditEvent', () => {
  it('turns every 1C verb into a sentence and a link target', () => {
    expect(describeSolarAuditEvent('access_granted', { level: 'edit' })).toEqual({ text: 'Solar access granted (Edit)', target: 'access' })
    expect(describeSolarAuditEvent('access_changed', { level: 'edit_financials' })).toEqual({ text: 'Solar access changed to Edit + financials', target: 'access' })
    expect(describeSolarAuditEvent('access_removed', {})).toEqual({ text: 'Solar access removed', target: 'access' })
    expect(describeSolarAuditEvent('access_request_approved', { level: 'view' })).toEqual({ text: 'Access request approved (View)', target: 'access' })
    expect(describeSolarAuditEvent('access_request_declined', { reason: 'x' })).toEqual({ text: 'Access request declined', target: 'access' })
    expect(describeSolarAuditEvent('access_copied', { copied: 3 })).toEqual({ text: 'Access copied from another project (3 copied)', target: 'access' })
    expect(describeSolarAuditEvent('site_saved', {})).toEqual({ text: 'Site & Supply saved', target: 'site' })
    // 1C owner default 3: Mark done on a subscribe request.
    expect(describeSolarAuditEvent('subscribe_request_done', {})).toEqual({ text: 'Subscription request marked done', target: 'access' })
  })
  it('falls back to a readable verb with no link for anything newer', () => {
    expect(describeSolarAuditEvent('case_run_finished', {})).toEqual({ text: 'case run finished', target: null })
  })
})

describe('report and proposal verbs (Phase 6)', () => {
  it('describes each and links to the Reports tab', () => {
    expect(describeSolarAuditEvent('report_generated', { kind: 'feasibility', version: 3 })).toEqual({ text: 'Feasibility report v3 generated', target: 'reports' })
    expect(describeSolarAuditEvent('proposal_issued', { version: 2 })).toEqual({ text: 'Proposal v2 issued', target: 'reports' })
    expect(describeSolarAuditEvent('proposal_accepted', { version: 2 })).toEqual({ text: 'Proposal v2 accepted by the client', target: 'reports' })
    expect(describeSolarAuditEvent('proposal_declined', { version: 1 })).toEqual({ text: 'Proposal v1 declined by the client', target: 'reports' })
    expect(describeSolarAuditEvent('proposal_withdrawn', { version: 1 }).target).toBe('reports')
  })
})
