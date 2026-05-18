/**
 * NodeInspectionsPanel — shows linked inspections for a single cable-schedule
 * node (board or source) with a "+ New inspection" CTA that pre-fills the
 * assignment wizard via search params.
 *
 * Mounted in two surfaces:
 *   - The cable-schedule structure tree (per-board/per-source row drill-down)
 *   - The /site/tag/[text] QR resolver page (after the cable-info card)
 *
 * Cross-schema joins are batched (no PostgREST embed across schemas — see
 * Session 22 cable-schedule notes + the /site/tag/[text] resolver for the
 * established pattern).
 */

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

type StatusVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'ghost'

const STATUS_VARIANT: Record<string, StatusVariant> = {
  assigned: 'info',
  in_progress: 'warning',
  'in-progress': 'warning',
  awaiting_verification: 'warning',
  certified: 'success',
  're-inspect_required': 'danger',
  abandoned: 'ghost',
  revoked: 'danger',
}

interface InspectionRow {
  id: string
  status: string
  coc_number: string | null
  template_id: string
  verifier_id: string | null
  certified_at: string | null
  created_at: string
}

interface TemplateRow {
  id: string
  name: string
  deliverable_type: string
}

interface Props {
  projectId: string
  nodeType: 'board' | 'source'
  nodeId: string
}

export default async function NodeInspectionsPanel({ projectId, nodeType, nodeId }: Props) {
  const supabase = (await createClient()) as AnyClient

  const { data: itemsData } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('id, status, coc_number, template_id, verifier_id, certified_at, created_at')
    .eq('project_id', projectId)
    .eq('target_node_type', nodeType)
    .eq('target_node_id', nodeId)
    .order('created_at', { ascending: false })

  const items = (itemsData as InspectionRow[] | null) ?? []

  // Hydrate templates separately — cross-schema embeds via PostgREST hit
  // PGRST200 (see Session 22 notes). Batched single round-trip.
  const templateIds = [...new Set(items.map((i) => i.template_id))]
  const { data: templatesData } = templateIds.length
    ? await supabase
        .schema('inspections')
        .from('templates')
        .select('id, name, deliverable_type')
        .in('id', templateIds)
    : { data: [] as TemplateRow[] }
  const templateMap = new Map(
    ((templatesData as TemplateRow[] | null) ?? []).map((t) => [t.id, t]),
  )

  const newHref =
    `/projects/${projectId}/inspections/new?` +
    `target_node_type=${encodeURIComponent(nodeType)}&` +
    `target_node_id=${encodeURIComponent(nodeId)}`

  return (
    <div
      style={{
        borderTop: '1px solid var(--c-border)',
        paddingTop: 12,
        marginTop: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <h4 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
          Inspections ({items.length})
        </h4>
        <Link href={newHref} style={{ textDecoration: 'none' }}>
          <Button variant="ghost" size="sm">+ New inspection</Button>
        </Link>
      </div>

      {items.length === 0 ? (
        <p
          style={{
            fontSize: 12,
            color: 'var(--c-text-dim)',
            fontStyle: 'italic',
            margin: 0,
          }}
        >
          No inspections yet.
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            fontSize: 12,
          }}
        >
          {items.map((i) => {
            const t = templateMap.get(i.template_id)
            const statusVariant = STATUS_VARIANT[i.status] ?? 'default'
            return (
              <li
                key={i.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--c-border-dim, var(--c-border))',
                  gap: 12,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--c-text-mid)' }}>
                    {t?.name ?? '(template missing)'}
                  </span>
                  {t?.deliverable_type && (
                    <Badge variant="ghost">{t.deliverable_type}</Badge>
                  )}
                  {i.coc_number && (
                    <span
                      style={{
                        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                        color: 'var(--c-text-dim)',
                        fontSize: 11,
                      }}
                    >
                      {i.coc_number}
                    </span>
                  )}
                </span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Badge variant={statusVariant}>{i.status.replace(/_/g, ' ')}</Badge>
                  <Link
                    href={`/projects/${projectId}/inspections/${i.id}`}
                    style={{
                      color: 'var(--c-amber)',
                      textDecoration: 'none',
                      fontWeight: 600,
                      fontSize: 11,
                    }}
                  >
                    View →
                  </Link>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
