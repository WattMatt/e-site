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
    source?: { code: string } | null
    from_board?: { code: string } | null
    to_board?: { code: string } | null
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

  const [cablesRes, tagsRes] = await Promise.all([
    (supabase as any)
      .schema('cable_schedule')
      .from('cables')
      .select(
        'id, cable_no, size_mm2, cores, conductor, insulation, armour, ' +
        'measured_length_m, confirmed_length_m, length_status, ohm_per_km, supply_id, ' +
        'derate_depth, derate_thermal, derate_grouping, derate_temp, ' +
        'supply:supplies!supply_id(' +
          'id, source:sources!from_source_id(code), from_board:boards!from_board_id(code), to_board:boards!to_board_id(code))',
      )
      .eq('revision_id', revisionId)
      .order('cable_no'),
    (supabase as any)
      .schema('cable_schedule')
      .from('cable_tags')
      .select('id, cable_id, end_position, tag_text, qr_payload, printed, printed_at, notes'),
  ])
  const cables = (cablesRes?.data ?? []) as unknown as CableJoin[]
  const allTags = (tagsRes?.data ?? []) as unknown as TagRow[]
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
    const fromLabel = c.supply.source?.code ?? c.supply.from_board?.code ?? '?'
    const toLabel = c.supply.to_board?.code ?? '?'
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
  const filtered = rowsAll.filter((r) => {
    if (filter === 'unprinted' && r.tag?.printed) return false
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
      <div style={{ marginBottom: 16 }}>
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

      <div className="page-header no-print">
        <div>
          <h1 className="page-title">Cable tag schedule<RevisionStatusBadge status={revision.status} /></h1>
          <p className="page-subtitle">
            {revision.code} · {cables.length} cable{cables.length !== 1 ? 's' : ''} ·
            {' '}{rowsAll.length} tag{rowsAll.length !== 1 ? 's' : ''}
            {filter === 'unprinted' && <> · filtered to unprinted</>}
          </p>
        </div>
        <TagControls
          revisionId={revisionId}
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
          {/* Screen view: table */}
          <div className="data-panel no-print" style={{ overflowX: 'auto' }}>
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

          {/* Print-only Critchley-style tag grid (10-up A4 portrait) */}
          <div className="print-only tag-grid">
            {filtered.filter((r) => r.tag).map((r) => (
              <div key={r.tag!.id} className="tag-card">
                <div className="tag-line-1">{r.atBoardLabel}</div>
                <div className="tag-line-2">{r.oppositeLabel}</div>
                <div className="tag-line-3">
                  {r.cable.size_mm2} mm² ({r.cable.cable_no} of N)
                </div>
                <div className="tag-line-4">
                  {project.name.slice(0, 30)} / {revision.code}
                </div>
                {qrByTagId.has(r.tag!.id) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrByTagId.get(r.tag!.id)!} alt="" className="tag-qr" />
                )}
              </div>
            ))}
          </div>

          <style>{`
            @media print {
              .no-print { display: none !important; }
              .print-only { display: grid !important; }
              .tag-grid {
                grid-template-columns: 1fr 1fr;
                gap: 6mm;
                padding: 10mm;
              }
              .tag-card {
                page-break-inside: avoid;
                border: 1px solid #000;
                padding: 6mm;
                font-family: monospace;
                position: relative;
                min-height: 40mm;
              }
              .tag-line-1 { font-weight: 700; font-size: 12pt; }
              .tag-line-2 { font-weight: 700; font-size: 12pt; }
              .tag-line-3 { font-size: 10pt; margin-top: 1mm; }
              .tag-line-4 { font-size: 8pt; color: #555; margin-top: 1mm; }
              .tag-qr { position: absolute; top: 4mm; right: 4mm; width: 18mm; height: 18mm; }
            }
            .print-only { display: none; }
          `}</style>
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
