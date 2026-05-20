import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import { activeLengthM, type CableForCalc } from '@esite/shared'
import { TagControls } from './TagControls'
import { RevisionStatusBadge } from '../RevisionStatusBadge'

export const metadata: Metadata = { title: 'Cable tag schedule' }

interface Props {
  params: Promise<{ id: string; revisionId: string }>
  searchParams: Promise<{ filter?: string; size?: string }>
}

interface CableForTag extends CableForCalc {
  cores: string
  conductor: 'CU' | 'AL'
  insulation: 'PVC' | 'XLPE' | 'PILC'
  armour: string | null
}

interface TagRow {
  id: string
  cable_id: string
  end_position: 'FROM' | 'TO'
  tag_text: string
  qr_payload: Record<string, unknown>
  printed: boolean
  printed_at: string | null
  notes: string | null
}

interface CableJoin {
  id: string
  cable_no: number
  size_mm2: number
  cores: string
  conductor: 'CU' | 'AL'
  insulation: 'PVC' | 'XLPE' | 'PILC'
  armour: string | null
  measured_length_m: number | null
  confirmed_length_m: number | null
  length_status: CableForCalc['length_status']
  ohm_per_km: number | null
  supply_id: string
  derate_depth: number | null
  derate_thermal: number | null
  derate_grouping: number | null
  derate_temp: number | null
  supply: {
    id: string
    from_source_id: string | null
    from_node_id: string | null
    to_node_id: string | null
  }
}

export default async function TagSchedulePage({ params, searchParams }: Props) {
  const { id: projectId, revisionId } = await params
  const { filter, size } = await searchParams
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  const { data: revisionRow } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, status, project_id')
    .eq('id', revisionId)
    .eq('project_id', projectId)
    .single()
  if (!revisionRow) notFound()
  const revision = revisionRow as { id: string; code: string; status: string; project_id: string }

  const [cablesRes, tagsRes, sourcesRes, nodesRes] = await Promise.all([
    (supabase as any)
      .schema('cable_schedule')
      .from('cables')
      .select(
        'id, cable_no, size_mm2, cores, conductor, insulation, armour, ' +
        'measured_length_m, confirmed_length_m, length_status, ohm_per_km, supply_id, ' +
        'derate_depth, derate_thermal, derate_grouping, derate_temp, ' +
        'supply:supplies!supply_id(id, from_source_id, from_node_id, to_node_id)',
      )
      .eq('revision_id', revisionId)
      .order('cable_no'),
    (supabase as any)
      .schema('cable_schedule')
      .from('cable_tags')
      .select('id, cable_id, end_position, tag_text, qr_payload, printed, printed_at, notes'),
    // Sources + nodes for label resolution — cross-schema embeds fail (PGRST200)
    (supabase as any)
      .schema('cable_schedule')
      .from('sources')
      .select('id, code')
      .eq('revision_id', revisionId),
    supabase
      .schema('structure')
      .from('nodes')
      .select('id, code')
      .eq('project_id', projectId),
  ])
  const cables = (cablesRes?.data ?? []) as unknown as CableJoin[]
  const allTags = (tagsRes?.data ?? []) as unknown as TagRow[]

  // Build label map: source codes + node codes
  const labelById = new Map<string, string>()
  for (const s of (sourcesRes?.data ?? []) as Array<{ id: string; code: string }>) {
    labelById.set(s.id, s.code)
  }
  for (const n of (nodesRes?.data ?? []) as Array<{ id: string; code: string }>) {
    labelById.set(n.id, n.code)
  }
  const label = (id: string | null | undefined): string =>
    (id && labelById.get(id)) || '?'
  const tagsByCable = new Map<string, TagRow[]>()
  for (const t of allTags) {
    if (!tagsByCable.has(t.cable_id)) tagsByCable.set(t.cable_id, [])
    tagsByCable.get(t.cable_id)!.push(t)
  }

  // Build rows: cable + FROM/TO tag (existing or placeholder). Render two
  // tag rows per cable (FROM and TO). Filter & size facets gate display.
  const cableIdSet = new Set(cables.map((c) => c.id))
  const rowsAll: Array<{
    sortKey: string
    tag: TagRow | null
    end: 'FROM' | 'TO'
    cable: CableJoin
    atBoardLabel: string
    oppositeLabel: string
    activeLengthM: number | null
  }> = []
  for (const c of cables) {
    const cableTags = (tagsByCable.get(c.id) ?? []).filter((t) => cableIdSet.has(t.cable_id))
    const fromTag = cableTags.find((t) => t.end_position === 'FROM') ?? null
    const toTag   = cableTags.find((t) => t.end_position === 'TO')   ?? null
    const fromLabel = label(c.supply.from_source_id ?? c.supply.from_node_id)
    const toLabel = label(c.supply.to_node_id)
    const len = activeLengthM(c as unknown as CableForCalc, 'as-built')
    rowsAll.push({
      sortKey: `${c.cable_no.toString().padStart(6, '0')}|${c.id}|FROM`,
      tag: fromTag, end: 'FROM', cable: c,
      atBoardLabel: fromLabel, oppositeLabel: toLabel,
      activeLengthM: len,
    })
    rowsAll.push({
      sortKey: `${c.cable_no.toString().padStart(6, '0')}|${c.id}|TO`,
      tag: toTag, end: 'TO', cable: c,
      atBoardLabel: toLabel, oppositeLabel: fromLabel,
      activeLengthM: len,
    })
  }
  rowsAll.sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  // Apply filters
  // 'unprinted' is the special status filter; any other non-empty filter
  // value is treated as a case-insensitive substring match against
  // tag_text. This makes the page honour ?filter=<tag_text> redirects
  // coming from the /site/tag/[text] QR resolver — without this the scan
  // landed on the unfiltered table.
  const filtered = rowsAll.filter((r) => {
    if (filter === 'unprinted' && r.tag?.printed) return false
    if (filter && filter !== 'unprinted') {
      const needle = filter.toLowerCase()
      const haystack = (r.tag?.tag_text ?? '').toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    if (size && Number(size) > 0 && r.cable.size_mm2 !== Number(size)) return false
    return true
  })

  const sizes = Array.from(new Set(cables.map((c) => c.size_mm2))).sort((a, b) => a - b)

  // Pre-render QR data URLs server-side so the print sheet renders without
  // a client-side QR library.
  const qrByTagId = new Map<string, string>()
  await Promise.all(
    filtered
      .filter((r) => r.tag)
      .map(async (r) => {
        try {
          // Encode the human-visible tag text only — never UUIDs.
          // qr_payload retains the UUID bundle in the DB for any future
          // server-side scan resolver, but the printed QR exposes nothing
          // beyond what's already legible on the physical label.
          //
          // Wrap as a URL so phone-camera scans (iOS Camera / Android Lens)
          // treat it as an actionable link instead of a search query. The
          // /site/tag/[text] route is follow-up work — until it ships the
          // scan will 404 on a known host, which is honest and recoverable.
          const qrText = r.tag!.tag_text || ''
          if (!qrText) return
          const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.e-site.live').replace(/\/$/, '')
          const qrUrl = `${siteUrl}/site/tag/${encodeURIComponent(qrText)}`
          const png = await QRCode.toDataURL(qrUrl, {
            margin: 0, width: 96, errorCorrectionLevel: 'M',
          })
          qrByTagId.set(r.tag!.id, png)
        } catch { /* ignore */ }
      }),
  )

  return (
    <div className="animate-fadeup">
      <div className="no-print" style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/cables/${revisionId}`}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em',
          }}
        >
          ← {revision.code} · {project.name}
        </Link>
      </div>

      {/* Print-only header — gives the printed schedule a proper title +
          context block. Replaces the screen page-header (which carries
          action buttons that shouldn't print). */}
      <div
        className="print-only"
        style={{
          marginBottom: 18,
          paddingBottom: 8,
          borderBottom: '0.5pt solid #707070',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: '12pt', fontWeight: 700, letterSpacing: '0.08em' }}>
          CABLE TAG SCHEDULE
        </div>
        <div style={{ fontSize: '9pt', color: '#4a4a4a', marginTop: 3 }}>
          {project.name} · {revision.code} ({revision.status}) · {cables.length} cable{cables.length !== 1 ? 's' : ''} · {rowsAll.length} tag{rowsAll.length !== 1 ? 's' : ''}
          {filter === 'unprinted' && <> · filtered to unprinted</>}
          {filter && filter !== 'unprinted' && <> · filtered to "{filter}"</>}
        </div>
      </div>

      <div className="page-header no-print">
        <div>
          <h1 className="page-title">Cable tag schedule<RevisionStatusBadge status={revision.status} /></h1>
          <p className="page-subtitle">
            {revision.code} · {cables.length} cable{cables.length !== 1 ? 's' : ''} ·
            {' '}{rowsAll.length} tag{rowsAll.length !== 1 ? 's' : ''}
            {filter === 'unprinted' && <> · filtered to unprinted</>}
            {filter && filter !== 'unprinted' && <> · filtered to "{filter}"</>}
          </p>
        </div>
        <TagControls
          revisionId={revisionId}
          projectId={projectId}
          missingTagsCount={cables.length * 2 - allTags.length}
          totalUnprinted={allTags.filter((t) => !t.printed).length}
          basePath={`/projects/${projectId}/cables/${revisionId}/tags`}
          currentFilter={filter ?? null}
          currentSize={size ?? null}
          sizes={sizes}
        />
      </div>

      {rowsAll.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px', textAlign: 'center' }}>
            🏷 No tags yet. Click "Generate tags" to create one per cable end.
          </div>
        </div>
      ) : (
        <>
          {/* Print-path hint — two valid outputs, this clarifies the choice.
              "Print sheet" button (TagControls) triggers window.print() which
              now produces a clean tag-schedule table thanks to the project-
              wide @media print rules in globals.css. The PDF export is the
              different output: a 10-up Critchley-style tag-card layout with
              QR codes, generated server-side via pdf-lib. */}
          <div
            className="no-print"
            style={{
              margin: '0 0 14px',
              padding: '10px 14px',
              borderLeft: '3px solid var(--c-accent, #e8923a)',
              background: 'var(--c-base, #f7f7f5)',
              fontSize: 12,
              color: 'var(--c-text-dim)',
              lineHeight: 1.5,
            }}
          >
            🖨  <strong style={{ color: 'var(--c-text)' }}>Two PDF outputs:</strong> <em>Download list (PDF)</em> (above) → multi-page A4 tag-schedule list, suitable as a site-coordination checklist. <em>Export → PDF</em> (from the revision page) → 10-up tag-card layout with QR codes for fabrication. An Avery-spec label-sheet export is on the roadmap. Browser Cmd-P also works for a quick screen-table print.
          </div>
          {/* Screen view: table */}
          <div className="data-panel" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              <thead>
                <tr style={{ background: 'var(--c-base)' }}>
                  <Th>#</Th>
                  <Th>Cable tag</Th>
                  <Th>End</Th>
                  <Th>At board</Th>
                  <Th>To</Th>
                  <Th>Description</Th>
                  <Th align="right">Length (m)</Th>
                  <Th>Status</Th>
                  <Th>QR</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, idx) => (
                  <tr key={r.tag?.id ?? `${r.cable.id}-${r.end}`}
                    style={{ borderTop: '1px solid var(--c-border)' }}>
                    <Td align="right">{(idx + 1).toString().padStart(3, '0')}</Td>
                    <Td>{r.tag?.tag_text ?? `${r.atBoardLabel}-${r.oppositeLabel}-${r.cable.size_mm2}-${r.cable.cable_no}`}</Td>
                    <Td>{r.end}</Td>
                    <Td>{r.atBoardLabel}</Td>
                    <Td>{r.oppositeLabel}</Td>
                    <Td>
                      {r.cable.cores}c × {r.cable.size_mm2}mm² {r.cable.conductor}/{r.cable.insulation}
                      {r.cable.armour ? `/${r.cable.armour}` : ''}/PVC
                    </Td>
                    <Td align="right">{r.activeLengthM == null ? '—' : r.activeLengthM.toFixed(1)}</Td>
                    <Td>
                      {r.tag ? (
                        <span className={`badge ${r.tag.printed ? 'badge-success' : 'badge-warning'}`}>
                          {r.tag.printed ? 'Printed' : 'Pending'}
                        </span>
                      ) : (
                        <span className="badge badge-muted">Not generated</span>
                      )}
                    </Td>
                    <Td>
                      {r.tag && qrByTagId.has(r.tag.id) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={qrByTagId.get(r.tag.id)!} alt="QR" width={24} height={24} />
                      ) : '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* No in-app print view: the admin layout chrome (sidebar +
              header) can't be cleanly excluded from @media print, so any
              attempt to Cmd-P from here renders the wrong shape. Use the
              ZIP/PDF export instead — it generates a clean 10-up A4 tag-
              page section server-side with no chrome to escape. */}
        </>
      )}
    </div>
  )
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align ?? 'left', padding: '8px 10px',
      fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: 'var(--c-text-dim)', fontWeight: 600, whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}

function Td({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td style={{
      textAlign: align ?? 'left', padding: '6px 10px', verticalAlign: 'top',
      color: 'var(--c-text)', whiteSpace: 'nowrap',
    }}>{children}</td>
  )
}
