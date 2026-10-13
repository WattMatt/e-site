'use client'

/** Step between a plan's sheets (?sheet=). Writers also get "Add sheets". Props are JSON only. */
import Link from 'next/link'
import type { StatusPlanPurpose } from '@esite/shared/status-plans'
import { tenantPlanHref } from '@/lib/status-plans/plan-urls'
import type { SheetSummary } from '@/lib/status-plans/types'
import { TenantPlanUploader } from './TenantPlanUploader'

export interface SheetStripProps {
  projectId: string
  purpose: StatusPlanPurpose
  sheets: SheetSummary[]
  currentId: string
  canEdit: boolean
}

const chip = { border: '1px solid var(--c-border)', borderRadius: 5, padding: '3px 8px', fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap' } as const

export function SheetStrip({ projectId, purpose, sheets, currentId, canEdit }: SheetStripProps) {
  const at = sheets.findIndex((s) => s.id === currentId)
  const prev = at > 0 ? sheets[at - 1]! : null
  const next = at >= 0 && at < sheets.length - 1 ? sheets[at + 1]! : null
  const href = (id: string) => tenantPlanHref(projectId, purpose, { sheet: id })

  return (
    <nav aria-label="Sheets" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {prev && <Link href={href(prev.id)} aria-label="Previous sheet" style={chip}>‹</Link>}
      <ol style={{ display: 'flex', gap: 6, listStyle: 'none', margin: 0, padding: 0, flexWrap: 'wrap' }}>
        {sheets.map((s, i) => {
          const current = s.id === currentId
          return (
            <li key={s.id}>
              <Link
                href={href(s.id)}
                aria-current={current ? 'page' : undefined}
                title={s.replacedAt ? 'File replaced — check the shapes' : s.fileName}
                style={{
                  ...chip,
                  fontWeight: current ? 700 : 400,
                  borderColor: s.replacedAt ? 'var(--c-amber)' : current ? 'var(--c-blue)' : 'var(--c-border)',
                  color: current ? 'var(--c-text)' : 'var(--c-text-mid)',
                }}
              >
                {i + 1}. {s.label}{s.replacedAt ? ' •' : ''}
              </Link>
            </li>
          )
        })}
      </ol>
      {next && <Link href={href(next.id)} aria-label="Next sheet" style={chip}>›</Link>}
      {canEdit && (
        <span style={{ marginLeft: 'auto' }}>
          <TenantPlanUploader projectId={projectId} purpose={purpose} label="Add sheets" />
        </span>
      )}
    </nav>
  )
}
