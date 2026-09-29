'use client'
/** Evidence panel (spec §9.3 "Acceptance record"): exactly what the server stamped. */
import type { ProposalEventView } from '@/lib/solar/reports/page-data'

const KIND: Record<string, string> = { issued: 'Issued', viewed: 'Viewed', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn', link_rotated: 'New link' }
const VIA: Record<string, string> = { app: 'E-Site', token: 'Secure link', portal: 'Client portal' }

export function AcceptanceRecord({ version, events }: { version: number; events: ProposalEventView[] }) {
  if (events.length === 0) return null
  return (
    <table aria-label={`Acceptance record v${version}`} style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginTop: 8 }}>
      <thead>
        <tr>{['Event', 'When (UTC)', 'Via', 'Name', 'Email', 'IP', 'User agent', 'PDF SHA-256', 'Authority', 'Signature', 'Reason'].map((h) => <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid var(--c-border)', padding: 4 }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {events.map((e, i) => (
          <tr key={i}>
            <td style={{ padding: 4 }}>{KIND[e.kind] ?? e.kind}</td>
            <td style={{ padding: 4 }}>{e.at.replace('T', ' ').slice(0, 19)}</td>
            <td style={{ padding: 4 }}>{VIA[e.via] ?? e.via}</td>
            <td style={{ padding: 4 }}>{e.actorName ?? ''}</td>
            <td style={{ padding: 4 }}>{e.actorEmail ?? ''}</td>
            <td style={{ padding: 4 }}>{e.ip ?? ''}</td>
            <td style={{ padding: 4, maxWidth: 160, overflowWrap: 'anywhere' }}>{e.userAgent ?? ''}</td>
            <td style={{ padding: 4, fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>{e.pdfSha256 ?? ''}</td>
            <td style={{ padding: 4 }}>{e.authority === null ? '' : e.authority ? 'Yes' : 'No'}</td>
            <td style={{ padding: 4 }}>{e.hasSignature ? 'Signed' : ''}</td>
            <td style={{ padding: 4 }}>{e.reason ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
