/**
 * Certificate Pack page
 *
 * Generates and displays the compliance certificate pack for a site.
 * Calls the compliance-complete edge function to get the latest status.
 * Renders a print-ready view (PDF exported via browser print).
 *
 * Spec § 7.2 T-027
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PrintButton } from './PrintButton'

interface Props {
  params: Promise<{ siteId: string }>
}

const COC_STATUS_LABELS: Record<string, string> = {
  missing: 'Missing',
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
}

const COC_STATUS_CLASSES: Record<string, string> = {
  missing: 'text-red-600',
  submitted: 'text-blue-600',
  under_review: 'text-amber-600',
  approved: 'text-green-700 font-semibold',
  rejected: 'text-red-600',
}

export default async function CertificatePackPage({ params }: Props) {
  const { siteId } = await params
  const supabase = await createClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  // Call the edge function for the pack data
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  const packRes = await fetch(`${supabaseUrl}/functions/v1/compliance-complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ siteId }),
    cache: 'no-store',
  })

  if (!packRes.ok) notFound()

  const pack = await packRes.json() as {
    complete: boolean
    score: number
    totalSubsections: number
    approvedSubsections: number
    siteName: string
    siteAddress: string
    siteId: string
    subsections: Array<{
      id: string
      name: string
      sansRef: string | null
      cocStatus: string
      latestUploadDate: string | null
      reviewerName: string | null
      reviewedAt: string | null
    }>
    generatedAt: string
  }

  const generatedDate = new Date(pack.generatedAt).toLocaleDateString('en-ZA', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  return (
    <div className="animate-fadeup">
      {/* Screen navigation (hidden in print) */}
      <div
        className="print:hidden"
        style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Link
          href={`/compliance/${siteId}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Back to site
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PrintButton />
        </div>
      </div>

      {/* Certificate pack — styled for both screen and print */}
      <div
        id="certificate-pack"
        className="bg-white text-slate-900 p-8 rounded-xl max-w-3xl mx-auto print:shadow-none print:rounded-none print:max-w-none print:p-0"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 pb-6 mb-6">
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
              E-Site Platform
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Compliance Certificate Pack
            </h1>
            <p className="text-slate-600 mt-1">{pack.siteName}</p>
            <p className="text-sm text-slate-500 mt-0.5">{pack.siteAddress}</p>
          </div>
          <div className="text-right">
            <div
              className={`text-4xl font-bold ${
                pack.score === 100
                  ? 'text-green-600'
                  : pack.score >= 50
                  ? 'text-amber-600'
                  : 'text-red-600'
              }`}
            >
              {pack.score}%
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {pack.approvedSubsections} / {pack.totalSubsections} approved
            </div>
            {pack.complete && (
              <div className="mt-2 inline-block bg-green-100 text-green-700 text-xs font-semibold px-3 py-1 rounded-full">
                Fully Compliant
              </div>
            )}
          </div>
        </div>

        {/* Metadata row */}
        <div className="grid grid-cols-2 gap-4 mb-8 text-sm">
          <div>
            <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Generated</p>
            <p className="text-slate-800">{generatedDate}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Site ID</p>
            <p className="text-slate-800 font-mono text-xs">{pack.siteId}</p>
          </div>
        </div>

        {/* Subsections table */}
        <h2 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">
          Subsection Status
        </h2>
        <table className="w-full text-sm border-collapse mb-8">
          <thead>
            <tr className="border-b-2 border-slate-200">
              <th className="text-left py-2 pr-4 text-slate-600 font-semibold">#</th>
              <th className="text-left py-2 pr-4 text-slate-600 font-semibold">Subsection</th>
              <th className="text-left py-2 pr-4 text-slate-600 font-semibold">SANS Ref</th>
              <th className="text-left py-2 pr-4 text-slate-600 font-semibold">Status</th>
              <th className="text-left py-2 pr-4 text-slate-600 font-semibold">Reviewed by</th>
              <th className="text-left py-2 text-slate-600 font-semibold">Review date</th>
            </tr>
          </thead>
          <tbody>
            {pack.subsections.map((sub, idx) => (
              <tr key={sub.id} className="border-b border-slate-100">
                <td className="py-2.5 pr-4 text-slate-400">{idx + 1}</td>
                <td className="py-2.5 pr-4 font-medium text-slate-800">{sub.name}</td>
                <td className="py-2.5 pr-4 text-slate-500 font-mono text-xs">{sub.sansRef ?? '—'}</td>
                <td className={`py-2.5 pr-4 ${COC_STATUS_CLASSES[sub.cocStatus] ?? 'text-slate-600'}`}>
                  {COC_STATUS_LABELS[sub.cocStatus] ?? sub.cocStatus}
                </td>
                <td className="py-2.5 pr-4 text-slate-600">{sub.reviewerName ?? '—'}</td>
                <td className="py-2.5 text-slate-600">
                  {sub.reviewedAt
                    ? new Date(sub.reviewedAt).toLocaleDateString('en-ZA')
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Footer */}
        <div className="border-t border-slate-200 pt-4 text-xs text-slate-400 flex justify-between">
          <span>
            This document was generated automatically by E-Site Platform. Verify at app.esite.co.za.
          </span>
          <span>Page 1 of 1</span>
        </div>
      </div>
    </div>
  )
}
