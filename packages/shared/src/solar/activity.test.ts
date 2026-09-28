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
  it('describes the Phase 2b tariff verbs without amounts', () => {
    expect(describeSolarAuditEvent('tariff_selected', { tariffId: 't' })).toEqual({ text: 'Tariff chosen', target: null })
    expect(describeSolarAuditEvent('tariff_override_created', {})).toEqual({ text: 'Project tariff override created', target: null })
    expect(describeSolarAuditEvent('tariff_override_row_edited', {})).toEqual({ text: 'Project tariff rate changed', target: null })
    expect(describeSolarAuditEvent('tariff_override_reverted', {})).toEqual({ text: 'Reverted to the published tariff', target: null })
    expect(describeSolarAuditEvent('export_rule_saved', { method: 'manual' })).toEqual({ text: 'Export credit rule saved', target: null })
    expect(describeSolarAuditEvent('escalation_saved', {})).toEqual({ text: 'Tariff escalation path saved', target: null })
    expect(describeSolarAuditEvent('bill_check_recorded', { billingMonth: '2026-03' })).toEqual({ text: 'Bill check recorded (2026-03)', target: null })
    expect(describeSolarAuditEvent('bill_check_deleted', { billCheckId: 'b1' })).toEqual({ text: 'Bill check deleted', target: null })
    expect(describeSolarAuditEvent('tariff_error_reported', {})).toEqual({ text: 'Tariff error reported to the library', target: null })
    expect(describeSolarAuditEvent('tariff_licensee_linked', {})).toEqual({ text: 'Supply authority linked to the tariff library', target: null })
  })
  it('falls back to a readable verb with no link for anything newer', () => {
    expect(describeSolarAuditEvent('case_run_finished', {})).toEqual({ text: 'case run finished', target: null })
  })
})
