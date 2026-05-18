import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import NodeInspectionsPanel from '@/components/inspections/NodeInspectionsPanel'

export const metadata: Metadata = { title: 'Cable tag lookup' }

interface Props {
  params: Promise<{ text: string }>
}

interface TagMatch {
  id: string
  tag_text: string
  end_position: 'FROM' | 'TO'
  cable: {
    id: string
    cable_no: number
    size_mm2: number
    conductor: 'CU' | 'AL'
    insulation: 'PVC' | 'XLPE' | 'PILC'
    armour: string | null
    supply: {
      from_board: { id: string; code: string; short_code: string | null } | null
      to_board: { id: string; code: string; short_code: string | null } | null
      source: { id: string; code: string } | null
    } | null
    revision: {
      id: string
      code: string
      status: 'DRAFT' | 'ISSUED' | 'SUPERSEDED'
      project_id: string
    } | null
  } | null
}

export default async function ScanTagPage({ params }: Props) {
  const { text: rawText } = await params
  const tagText = decodeURIComponent(rawText)
  const supabase = await createClient()

  // Auth gate lives here (not in (scan)/layout.tsx) so the actual
  // scanned path survives the sign-in round-trip — otherwise the user
  // lands on /site after login and has to re-scan. rawText is preserved
  // unmodified so the /login redirect's ?next= contains the same bytes
  // the QR encoded.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/site/tag/${rawText}`)}`)
  }

  // Case-insensitive match across all cable_tags visible to the caller via
  // RLS. The tag_text isn't globally unique (a "MS1-DB1-240-1" can exist
  // on multiple projects); we resolve cross-org via the existing
  // cable_schedule.cable_tags RLS which gates by org membership.
  //
  // NOTE: project name is fetched in a follow-up query via projectService —
  // the projects.projects table lives in a different schema and a nested
  // PostgREST select across schemas hits PGRST200. Mirrors the pattern in
  // (admin)/projects/[id]/cables/page.tsx.
  const { data: matchesData } = await (supabase as any)
    .schema('cable_schedule')
    .from('cable_tags')
    .select(
      'id, tag_text, end_position, ' +
      'cable:cables!cable_id(' +
        'id, cable_no, size_mm2, conductor, insulation, armour, ' +
        'supply:supplies!supply_id(' +
          'from_board:boards!from_board_id(id, code, short_code), ' +
          'to_board:boards!to_board_id(id, code, short_code), ' +
          'source:sources!from_source_id(id, code)' +
        '), ' +
        'revision:revisions!revision_id(id, code, status, project_id)' +
      ')'
    )
    .ilike('tag_text', tagText)
    .limit(10)

  const matches = (matchesData ?? []) as TagMatch[]

  // Hydrate project names in a single follow-up call (cross-schema join
  // would have been a PGRST200 trap).
  const projectIds = Array.from(
    new Set(
      matches
        .map((m) => m.cable?.revision?.project_id)
        .filter((id): id is string => typeof id === 'string')
    )
  )
  const projectNameById = new Map<string, string>()
  await Promise.all(
    projectIds.map(async (pid) => {
      const p = await projectService.getById(supabase as never, pid).catch(() => null)
      if (p) projectNameById.set(pid, p.name)
    })
  )

  if (matches.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 16px' }}>Tag not found</h1>
        <p style={{ marginBottom: 8, color: 'var(--c-text-mid, #555)' }}>
          No cable tag matching the following text was found in any project you have access to:
        </p>
        <code style={{
          display: 'block',
          padding: '12px 14px',
          background: 'var(--c-base, #f7f7f5)',
          border: '1px solid var(--c-border, #e3e3e0)',
          borderRadius: 6,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 14,
          marginBottom: 24,
          wordBreak: 'break-all',
        }}>
          {tagText}
        </code>
        <Link href="/dashboard" style={{
          display: 'inline-block',
          padding: '10px 16px',
          background: 'var(--c-amber, #e8923a)',
          color: '#0A0808',
          textDecoration: 'none',
          borderRadius: 6,
          fontWeight: 700,
          fontSize: 13,
        }}>← Back to dashboard</Link>
      </div>
    )
  }

  if (matches.length > 1) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>Multiple matches</h1>
        <p style={{ marginBottom: 16, color: 'var(--c-text-mid, #555)' }}>
          The tag <code style={{ fontFamily: 'ui-monospace, monospace' }}>{tagText}</code> appears on {matches.length} revisions. Pick one:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {matches.map((m) => {
            const projectId = m.cable?.revision?.project_id ?? ''
            const revisionId = m.cable?.revision?.id ?? ''
            const projectName = projectNameById.get(projectId) ?? '?'
            return (
              <Link
                key={m.id}
                href={`/projects/${projectId}/cables/${revisionId}/tags?filter=${encodeURIComponent(m.tag_text)}`}
                style={{
                  display: 'block',
                  padding: '14px 16px',
                  background: 'var(--c-panel, #fff)',
                  border: '1px solid var(--c-border, #e3e3e0)',
                  borderRadius: 6,
                  textDecoration: 'none',
                  color: 'var(--c-text, #111)',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {projectName}
                </div>
                <div style={{ fontSize: 12, color: 'var(--c-text-mid, #555)', marginTop: 2 }}>
                  {m.cable?.revision?.code} ({m.cable?.revision?.status}) · END: {m.end_position}
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    )
  }

  // Exactly one match — render detail card
  const m = matches[0]
  const c = m.cable
  if (!c || !c.revision) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 16px' }}>Tag found but data incomplete</h1>
        <p style={{ marginBottom: 16, color: 'var(--c-text-mid, #555)' }}>
          The cable or revision linked to this tag is missing. Data may be stale.
        </p>
        <Link href="/dashboard" style={{
          display: 'inline-block',
          padding: '10px 16px',
          background: 'var(--c-amber, #e8923a)',
          color: '#0A0808',
          textDecoration: 'none',
          borderRadius: 6,
          fontWeight: 700,
          fontSize: 13,
        }}>← Back to dashboard</Link>
      </div>
    )
  }

  const fromLabel = c.supply?.source?.code
    ?? c.supply?.from_board?.short_code
    ?? c.supply?.from_board?.code
    ?? '?'
  const toLabel = c.supply?.to_board?.short_code
    ?? c.supply?.to_board?.code
    ?? '?'

  const projectName = projectNameById.get(c.revision.project_id) ?? '?'

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--c-text-dim, #888)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
        Cable tag
      </div>
      <h1 style={{
        fontSize: 26,
        fontWeight: 800,
        margin: '0 0 4px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        wordBreak: 'break-all',
      }}>
        {m.tag_text}
      </h1>
      <div style={{ fontSize: 13, color: 'var(--c-text-mid, #555)', marginBottom: 20 }}>
        END: {m.end_position}
      </div>

      <div style={{
        padding: '16px 18px',
        background: 'var(--c-base, #f7f7f5)',
        border: '1px solid var(--c-border, #e3e3e0)',
        borderRadius: 8,
        marginBottom: 16,
      }}>
        <Row label="Project" value={projectName} />
        <Row label="Revision" value={`${c.revision.code} (${c.revision.status})`} />
        <Row label="Cable" value={`#${c.cable_no}`} />
        <Row label="Size" value={`${c.size_mm2} mm² ${c.conductor === 'CU' ? 'Cu' : 'Al'} ${c.insulation}${c.armour ? `/${c.armour}` : ''}`} />
        <Row label="From" value={fromLabel} />
        <Row label="To" value={toLabel} last />
      </div>

      <Link
        href={`/projects/${c.revision.project_id}/cables/${c.revision.id}/tags?filter=${encodeURIComponent(m.tag_text)}`}
        style={{
          display: 'block',
          padding: '12px 18px',
          background: 'var(--c-amber, #e8923a)',
          color: '#0A0808',
          textDecoration: 'none',
          borderRadius: 6,
          fontWeight: 700,
          fontSize: 13,
          textAlign: 'center',
        }}
      >
        Open in cable schedule →
      </Link>

      {/* Surface inspections linked to the destination board this cable terminates at. */}
      {c.supply?.to_board?.id && (
        <NodeInspectionsPanel
          projectId={c.revision.project_id}
          nodeType="board"
          nodeId={c.supply.to_board.id}
        />
      )}
    </div>
  )
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '8px 0',
      borderBottom: last ? 'none' : '1px solid var(--c-border, #e3e3e0)',
      gap: 12,
    }}>
      <span style={{ color: 'var(--c-text-dim, #888)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ color: 'var(--c-text, #111)', fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  )
}
