import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { loadSolarAccessPanel } from '@/lib/solar/access-panel'
import { AccessPanel } from './AccessPanel'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Solar access' }

/**
 * Grantors only (spec §1.3). OUTSIDE solar/(gated): owners/admins may set up
 * grants before the org subscribes (00208 keeps project_access ungated by
 * subscription), and the gated layout would bounce them to /locked.
 */
export default async function SolarAccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await loadSolarAccessPanel(id)
  if (!data) redirect(`/projects/${id}/solar`)
  return (
    <div className="animate-fadeup" style={{ maxWidth: 1080 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${id}/solar`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Solar
        </Link>
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Solar access</h1>
          <p className="page-subtitle">{data.projectName}</p>
        </div>
      </div>
      <AccessPanel data={data} />
    </div>
  )
}
