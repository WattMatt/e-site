import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Site capture' }

interface PendingCable {
  id: string
  cable_no: number
  size_mm2: number
  measured_length_m: number | null
  confirmed_length_m: number | null
  length_status: 'UNMEASURED' | 'MEASURED' | 'CONFIRMED' | 'DISCREPANCY'
  revision: { id: string; code: string; project_id: string }
  supply: {
    source?: { code: string } | null
    from_board?: { code: string } | null
    to_board?: { code: string } | null
  }
  project_name: string
}

export default async function SiteCapturePage() {
  const supabase = await createClient()

  // Pull every cable that's still pending site confirmation across all
  // accessible DRAFT revisions. RLS filters to the user's orgs + project
  // memberships.
  const { data: cables } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select(
      'id, cable_no, size_mm2, measured_length_m, confirmed_length_m, length_status, ' +
      'revision:revisions!revision_id(id, code, status, project_id, project:projects!project_id(name)), ' +
      'supply:supplies!supply_id(source:sources!from_source_id(code), from_board:boards!from_board_id(code), to_board:boards!to_board_id(code))',
    )
    .in('length_status', ['UNMEASURED', 'MEASURED', 'DISCREPANCY'])
    .order('cable_no')
    .limit(200)
  const rows = (((cables ?? []) as any[]).map((c) => ({
    id: c.id,
    cable_no: c.cable_no,
    size_mm2: Number(c.size_mm2),
    measured_length_m: c.measured_length_m == null ? null : Number(c.measured_length_m),
    confirmed_length_m: c.confirmed_length_m == null ? null : Number(c.confirmed_length_m),
    length_status: c.length_status,
    revision: { id: c.revision.id, code: c.revision.code, project_id: c.revision.project_id },
    supply: c.supply,
    project_name: c.revision.project?.name ?? '?',
  })).filter((c) => c.revision)) as PendingCable[]

  // Group by (project, revision)
  type GroupKey = string
  const groups = new Map<GroupKey, { project_name: string; rev_code: string; project_id: string; revision_id: string; cables: PendingCable[] }>()
  for (const c of rows) {
    const key = `${c.revision.project_id}|${c.revision.id}`
    if (!groups.has(key)) {
      groups.set(key, {
        project_name: c.project_name,
        rev_code: c.revision.code,
        project_id: c.revision.project_id,
        revision_id: c.revision.id,
        cables: [],
      })
    }
    groups.get(key)!.cables.push(c)
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Site capture</h1>
          <p className="page-subtitle">
            Cables awaiting confirmed length on every DRAFT revision you have
            access to. Tap a cable to enter the pulled length on the relevant
            revision page.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px', textAlign: 'center' }}>
            ✅ Nothing pending. Every cable in every DRAFT has a confirmed length signed off.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[...groups.values()].map((g) => (
            <div key={`${g.project_id}|${g.revision_id}`} className="data-panel">
              <div className="data-panel-header">
                <span className="data-panel-title">
                  {g.project_name} · {g.rev_code}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
                  color: 'var(--c-text-dim)',
                }}>
                  {g.cables.length} pending
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {g.cables.map((c) => {
                  const from = c.supply.source?.code ?? c.supply.from_board?.code ?? '?'
                  const to = c.supply.to_board?.code ?? '?'
                  return (
                    <Link
                      key={c.id}
                      href={`/projects/${g.project_id}/cables/${g.revision_id}#cable-${c.id}`}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        padding: '16px 18px',
                        borderTop: '1px solid var(--c-border)',
                        textDecoration: 'none',
                        color: 'inherit',
                      }}
                    >
                      <div style={{
                        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                        gap: 10, flexWrap: 'wrap',
                      }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700 }}>
                          {from} → {to}
                        </div>
                        <span className={`badge ${
                          c.length_status === 'DISCREPANCY' ? 'badge-error'
                          : c.length_status === 'MEASURED' ? 'badge-warning'
                          : 'badge-muted'
                        }`}>
                          {c.length_status}
                        </span>
                      </div>
                      <div style={{
                        fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)',
                        display: 'flex', gap: 12, flexWrap: 'wrap',
                      }}>
                        <span>{c.size_mm2} mm² · cable {c.cable_no}</span>
                        <span>
                          measured {c.measured_length_m == null ? '—' : c.measured_length_m.toFixed(1) + ' m'}
                        </span>
                        <span>
                          confirmed {c.confirmed_length_m == null ? '—' : c.confirmed_length_m.toFixed(1) + ' m'}
                        </span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{
        marginTop: 18, padding: 12,
        fontSize: 12, color: 'var(--c-text-dim)',
        background: 'var(--c-base)', border: '1px dashed var(--c-border)', borderRadius: 6,
      }}>
        <strong>QR scan + offline IndexedDB queue + CSV bulk import</strong> ship in a follow-up
        polish slice; for now site teams tap into the cable, enter the pulled length
        + method, and submit. The Verifier signs off from the desk on the same form.
      </div>
    </div>
  )
}
