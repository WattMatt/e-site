/**
 * Workspace Load profiles: the org's metered sites (Solar meter library, grouped by site). The archive
 * sites are entries here, not projects (owner, 2026-10-05). Each opens its own profile.
 */
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireRolePage } from '@/lib/auth/require-role'
import { ARCHIVE_READ_ROLES } from '@/lib/load-profile/access'
import { listArchiveSites } from '@/lib/load-profile/archive'
import type { AnyClient } from '@/lib/load-profile/load'

export const dynamic = 'force-dynamic'

const KIND_ORDER = ['bulk', 'council', 'tenant', 'common', 'vacant', 'check', 'virtual', 'unknown', 'solar', 'generator']

export default async function LoadProfilesPage() {
  await requireRolePage(ARCHIVE_READ_ROLES)
  const supabase = (await createClient()) as unknown as AnyClient
  const sites = await listArchiveSites(supabase)
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Load profiles</h1>
          <p className="page-subtitle">Metered sites in your organisation&apos;s meter library. Open a site for its profile, peaks, maximum demand and NMD suggestion; add its meters to a project&apos;s Load profile tab to cost it against a tariff.</p>
        </div>
      </div>
      {sites.length === 0 ? (
        <div className="card empty-state"><p>No metered sites yet. Meters appear here once they are loaded into the Solar meter library.</p></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="table" style={{ width: '100%', fontSize: 13 }}>
            <thead><tr><th>Site</th><th style={{ textAlign: 'right' }}>Meters</th><th>Types</th></tr></thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.site}>
                  <td><Link href={`/load-profiles/${encodeURIComponent(s.site)}`}>{s.site}</Link></td>
                  <td style={{ textAlign: 'right' }}>{s.meters}</td>
                  <td style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
                    {Object.entries(s.kinds).sort((a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0])).map(([k, n]) => `${n} ${k}`).join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
