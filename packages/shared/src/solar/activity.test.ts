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
  it('describes schedule events and links them to the Schedule tab', () => {
    expect(describeSolarAuditEvent('schedule_tasks_added', { count: 3 })).toEqual({ text: '3 schedule tasks added', target: 'schedule' })
    expect(describeSolarAuditEvent('schedule_tasks_added', { count: 1 })).toEqual({ text: 'Schedule task added', target: 'schedule' })
    expect(describeSolarAuditEvent('schedule_tasks_removed', { count: 1 })).toEqual({ text: 'Schedule task removed', target: 'schedule' })
    expect(describeSolarAuditEvent('schedule_tasks_removed', { count: 4 })).toEqual({ text: '4 schedule tasks removed', target: 'schedule' })
    expect(describeSolarAuditEvent('schedule_imported', { count: 12, mode: 'replace' }))
      .toEqual({ text: 'Schedule imported (12 tasks, replaced the programme)', target: 'schedule' })
    expect(describeSolarAuditEvent('schedule_imported', { count: 5, mode: 'append' }))
      .toEqual({ text: 'Schedule imported (5 tasks)', target: 'schedule' })
    expect(describeSolarAuditEvent('schedule_template_applied', { count: 14 })).toEqual({ text: 'Standard programme added (14 tasks)', target: 'schedule' })
    expect(describeSolarAuditEvent('schedule_baseline_saved', { name: 'Contract' })).toEqual({ text: 'Baseline “Contract” saved', target: 'schedule' })
    expect(describeSolarAuditEvent('schedule_baseline_saved', {})).toEqual({ text: 'Baseline saved', target: 'schedule' })
  })
  it('falls back to a readable verb with no link for anything newer', () => {
    expect(describeSolarAuditEvent('case_run_finished', {})).toEqual({ text: 'case run finished', target: null })
  })
})
