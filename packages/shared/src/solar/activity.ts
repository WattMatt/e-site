/** solar.audit_events row → one sentence for Overview → Recent activity (spec §2.1 item 4). */
import { isSolarAccessLevel } from './access'
import { SOLAR_LEVEL_LABELS } from './entry'

export type SolarActivityTarget = 'access' | 'site' | 'schedule' | 'reports' | 'operations' | null

export function describeSolarAuditEvent(
  verb: string,
  ref: Record<string, unknown>,
): { text: string; target: SolarActivityTarget } {
  const level = isSolarAccessLevel(ref.level) ? SOLAR_LEVEL_LABELS[ref.level] : null
  switch (verb) {
    case 'access_granted':
      return { text: level ? `Solar access granted (${level})` : 'Solar access granted', target: 'access' }
    case 'access_changed':
      return { text: level ? `Solar access changed to ${level}` : 'Solar access changed', target: 'access' }
    case 'access_removed':
      return { text: 'Solar access removed', target: 'access' }
    case 'access_request_approved':
      return { text: level ? `Access request approved (${level})` : 'Access request approved', target: 'access' }
    case 'access_request_declined':
      return { text: 'Access request declined', target: 'access' }
    case 'access_copied':
      return { text: `Access copied from another project (${Number(ref.copied ?? 0)} copied)`, target: 'access' }
    case 'subscribe_request_done':
      return { text: 'Subscription request marked done', target: 'access' }
    case 'site_saved':
      return { text: 'Site & Supply saved', target: 'site' }
    // Phase 2b Tariff tab: sentences only, never an amount (View users read the feed).
    case 'tariff_selected':
      return { text: 'Tariff chosen', target: null }
    case 'tariff_licensee_linked':
      return { text: 'Supply authority linked to the tariff library', target: null }
    case 'tariff_override_created':
      return { text: 'Project tariff override created', target: null }
    case 'tariff_override_row_edited':
      return { text: 'Project tariff rate changed', target: null }
    case 'tariff_override_reverted':
      return { text: 'Reverted to the published tariff', target: null }
    case 'export_rule_saved':
      return { text: 'Export credit rule saved', target: null }
    case 'escalation_saved':
      return { text: 'Tariff escalation path saved', target: null }
    case 'bill_check_recorded':
      return { text: typeof ref.billingMonth === 'string' ? `Bill check recorded (${ref.billingMonth})` : 'Bill check recorded', target: null }
    case 'bill_check_deleted':
      return { text: 'Bill check deleted', target: null }
    case 'tariff_error_reported':
      return { text: 'Tariff error reported to the library', target: null }
    case 'schedule_tasks_added': {
      const n = Number(ref.count ?? 1)
      return { text: n === 1 ? 'Schedule task added' : `${n} schedule tasks added`, target: 'schedule' }
    }
    case 'schedule_tasks_removed': {
      const n = Number(ref.count ?? 1)
      return { text: n === 1 ? 'Schedule task removed' : `${n} schedule tasks removed`, target: 'schedule' }
    }
    case 'schedule_imported':
      return { text: `Schedule imported (${Number(ref.count ?? 0)} tasks${ref.mode === 'replace' ? ', replaced the programme' : ''})`, target: 'schedule' }
    case 'schedule_template_applied':
      return { text: `Standard programme added (${Number(ref.count ?? 0)} tasks)`, target: 'schedule' }
    case 'schedule_baseline_saved':
      return { text: typeof ref.name === 'string' ? `Baseline “${ref.name}” saved` : 'Baseline saved', target: 'schedule' }
    case 'report_generated': {
      const kind = ref.kind === 'feasibility' ? 'Feasibility' : ref.kind === 'technical' ? 'Technical' : 'Solar'
      return { text: `${kind} report v${Number(ref.version ?? 1)} generated`, target: 'reports' }
    }
    case 'proposal_created':
      return { text: `Proposal v${Number(ref.version ?? 1)} drafted`, target: 'reports' }
    case 'proposal_issued':
      return { text: `Proposal v${Number(ref.version ?? 1)} issued`, target: 'reports' }
    case 'proposal_withdrawn':
      return { text: `Proposal v${Number(ref.version ?? 1)} withdrawn`, target: 'reports' }
    case 'proposal_link_rotated':
      return { text: `Proposal v${Number(ref.version ?? 1)}: new client link`, target: 'reports' }
    case 'proposal_accepted':
      return { text: `Proposal v${Number(ref.version ?? 1)} accepted by the client`, target: 'reports' }
    case 'proposal_declined':
      return { text: `Proposal v${Number(ref.version ?? 1)} declined by the client`, target: 'reports' }
    case 'installation_created':
      return { text: 'Installation recorded', target: 'operations' }
    case 'installation_saved':
      return { text: 'Installation details saved', target: 'operations' }
    case 'meter_linked':
      return { text: `Meter linked for ${ref.role === 'consumption' ? 'consumption' : 'generation'}`, target: 'operations' }
    case 'meter_unlinked':
      return { text: 'Meter unlinked', target: 'operations' }
    case 'guarantee_saved':
      return { text: 'Guarantee basis saved', target: 'operations' }
    case 'irradiation_saved':
      return { text: `Irradiation recorded for ${String(ref.month ?? '')}`, target: 'operations' }
    case 'downtime_added':
      return { text: `Downtime recorded (${Number(ref.hours ?? 0)} h)`, target: 'operations' }
    case 'downtime_updated':
      return { text: 'Downtime updated', target: 'operations' }
    case 'downtime_deleted':
      return { text: 'Downtime removed', target: 'operations' }
    case 'monthly_report_generated':
      return { text: `Monthly report ${String(ref.period ?? '')} v${Number(ref.version ?? 1)} generated`, target: 'operations' }
    case 'handover_updated':
      return { text: `Handover: ${String(ref.item ?? 'item')} updated`, target: 'operations' }
    default:
      return { text: verb.replace(/_/g, ' '), target: null }
  }
}
