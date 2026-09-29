import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PROPOSAL_STATUS_LABELS, zar, type EffectiveProposalStatus } from '@esite/shared/solar-reports'
import { requirePortalAccess } from '@/lib/portal/data'
import { loadPortalProposals } from '@/lib/solar/proposals/client'
import { PortalCard, EmptyState } from '@/components/portal/PortalBits'

export const dynamic = 'force-dynamic'

/** Issued Solar proposals for a portal user on this project (spec §9.4, D-18). */
export default async function PortalProposalsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const access = await requirePortalAccess(projectId)
  if (!access) notFound()
  const rows = await loadPortalProposals(projectId, access.userId)
  if (rows.length === 0) return <PortalCard><EmptyState label="No proposals have been issued to you on this project." /></PortalCard>
  return (
    <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
      {rows.map((r) => {
        const state = String(r.state) as EffectiveProposalStatus
        const offer = typeof r.offerExclVatZar === 'number' ? `${zar(r.offerExclVatZar)} excl. VAT` : null
        return (
          <li key={String(r.proposalId)} style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: 12 }}>
            <Link href={`/portal/${projectId}/proposals/${String(r.proposalId)}`}>{String(r.title ?? 'Solar proposal')}</Link>
            <div style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
              {[`v${String(r.version)}`, PROPOSAL_STATUS_LABELS[state] ?? state, offer, r.expiresAt ? `valid until ${String(r.expiresAt).slice(0, 10)}` : null].filter(Boolean).join(' · ')}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
