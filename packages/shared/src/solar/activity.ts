/** solar.audit_events row → one sentence for Overview → Recent activity (spec §2.1 item 4). */
import { isSolarAccessLevel } from './access'
import { SOLAR_LEVEL_LABELS } from './entry'

export type SolarActivityTarget = 'access' | 'site' | 'reports' | null

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
    default:
      return { text: verb.replace(/_/g, ' '), target: null }
  }
}
