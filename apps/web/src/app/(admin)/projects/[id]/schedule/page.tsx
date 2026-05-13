import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import { AddScheduleItemForm } from './AddScheduleItemForm'
import { ScheduleRow } from './ScheduleRow'

export const metadata: Metadata = { title: 'Engineer schedule' }

interface Props {
  params: Promise<{ id: string }>
}

interface ScheduleRowData {
  id: string
  item_code: string | null
  description: string
  specification: string | null
  quantity: number
  unit: string | null
  estimated_unit_cost: number | null
  currency: string
  instructions: string | null
  shop_drawing_required: boolean
  status: 'open' | 'partially_ordered' | 'fully_ordered' | 'fully_delivered' | 'cancelled'
  created_at: string
}

interface ProcurementByScheduleRow {
  schedule_item_id: string | null
  quantity: number | null
  status: string
  quoted_price: number | null
  currency: string | null
}

const STATUS_LABELS: Record<ScheduleRowData['status'], string> = {
  open: 'Open',
  partially_ordered: 'Partly ordered',
  fully_ordered: 'Fully ordered',
  fully_delivered: 'Delivered',
  cancelled: 'Cancelled',
}

const STATUS_TONE: Record<ScheduleRowData['status'], string> = {
  open: 'badge-neutral',
  partially_ordered: 'badge-warning',
  fully_ordered: 'badge-info',
  fully_delivered: 'badge-success',
  cancelled: 'badge-muted',
}

function fmtZAR(n: number | null): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 2,
  }).format(n)
}

export default async function SchedulePage({ params }: Props) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  const [scheduleRes, procurementRes] = await Promise.all([
    (supabase as any)
      .schema('projects')
      .from('engineer_equipment_schedule')
      .select(
        'id, item_code, description, specification, quantity, unit, ' +
        'estimated_unit_cost, currency, instructions, shop_drawing_required, ' +
        'status, created_at',
      )
      .eq('project_id', projectId)
      .order('item_code', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
    // Aggregate procurement coverage per schedule line.
    (supabase as any)
      .schema('projects')
      .from('procurement_items')
      .select('schedule_item_id, quantity, status, quoted_price, currency')
      .eq('project_id', projectId)
      .not('schedule_item_id', 'is', null),
  ])

  const items = (scheduleRes?.data ?? []) as unknown as ScheduleRowData[]
  const procurements = (procurementRes?.data ?? []) as unknown as ProcurementByScheduleRow[]

  // Roll up ordered qty + value per schedule line.
  const coverageByScheduleId = new Map<
    string,
    { orderedQty: number; orderedValue: number; orderCount: number }
  >()
  for (const p of procurements) {
    if (!p.schedule_item_id) continue
    const c = coverageByScheduleId.get(p.schedule_item_id) ?? {
      orderedQty: 0,
      orderedValue: 0,
      orderCount: 0,
    }
    // "Ordered" = approved or beyond. quoted/draft don't count toward coverage.
    if (['approved', 'fulfilled'].includes(p.status)) {
      c.orderedQty += Number(p.quantity ?? 0)
      c.orderedValue +=
        Number(p.quantity ?? 0) * Number(p.quoted_price ?? 0)
    }
    c.orderCount += 1
    coverageByScheduleId.set(p.schedule_item_id, c)
  }

  const totals = items.reduce(
    (acc, it) => {
      acc.lines += 1
      acc.scheduledQty += Number(it.quantity)
      acc.scheduledValue +=
        Number(it.quantity) * Number(it.estimated_unit_cost ?? 0)
      const c = coverageByScheduleId.get(it.id)
      acc.orderedValue += c?.orderedValue ?? 0
      return acc
    },
    { lines: 0, scheduledQty: 0, scheduledValue: 0, orderedValue: 0 },
  )

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Engineer schedule</h1>
          <p className="page-subtitle">
            {project.name} · {items.length} line{items.length !== 1 ? 's' : ''}
            {totals.scheduledValue > 0 && (
              <> · est. {fmtZAR(totals.scheduledValue)}</>
            )}
            {totals.orderedValue > 0 && (
              <> · {fmtZAR(totals.orderedValue)} ordered</>
            )}
          </p>
        </div>
      </div>

      <AddScheduleItemForm projectId={projectId} />

      {items.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
            📋 No schedule lines yet. Add the equipment the engineer has specified
            so procurement can track ordering and value against the BOM.
          </div>
        </div>
      ) : (
        <div className="data-panel" style={{ overflow: 'hidden' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ background: 'var(--c-base)' }}>
                <Th>Code</Th>
                <Th>Description</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Est. unit</Th>
                <Th align="right">Est. total</Th>
                <Th align="right">Ordered</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const coverage = coverageByScheduleId.get(it.id)
                const estTotal =
                  it.estimated_unit_cost != null
                    ? Number(it.quantity) * Number(it.estimated_unit_cost)
                    : null
                return (
                  <tr
                    key={it.id}
                    style={{ borderTop: '1px solid var(--c-border)' }}
                  >
                    <Td mono>{it.item_code ?? '—'}</Td>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{it.description}</div>
                      {it.specification && (
                        <div
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            color: 'var(--c-text-dim)',
                            marginTop: 2,
                          }}
                        >
                          {it.specification}
                        </div>
                      )}
                      {it.shop_drawing_required && (
                        <div
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            color: 'var(--c-amber)',
                            marginTop: 2,
                          }}
                        >
                          Shop drawing required
                        </div>
                      )}
                      {it.instructions && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--c-text-mid)',
                            marginTop: 4,
                            fontStyle: 'italic',
                          }}
                        >
                          {it.instructions}
                        </div>
                      )}
                    </Td>
                    <Td align="right" mono>
                      {Number(it.quantity)}
                      {it.unit ? ` ${it.unit}` : ''}
                    </Td>
                    <Td align="right" mono>
                      {fmtZAR(
                        it.estimated_unit_cost != null
                          ? Number(it.estimated_unit_cost)
                          : null,
                      )}
                    </Td>
                    <Td align="right" mono>
                      {fmtZAR(estTotal)}
                    </Td>
                    <Td align="right" mono>
                      {coverage
                        ? `${coverage.orderedQty} / ${Number(it.quantity)}`
                        : '0 / ' + Number(it.quantity)}
                    </Td>
                    <Td>
                      <span className={`badge ${STATUS_TONE[it.status]}`}>
                        {STATUS_LABELS[it.status]}
                      </span>
                    </Td>
                    <Td align="right">
                      <ScheduleRow id={it.id} currentStatus={it.status} />
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Th({
  children,
  align,
}: {
  children?: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <th
      style={{
        textAlign: align ?? 'left',
        padding: '10px 12px',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--c-text-dim)',
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  align,
  mono,
}: {
  children?: React.ReactNode
  align?: 'left' | 'right'
  mono?: boolean
}) {
  return (
    <td
      style={{
        textAlign: align ?? 'left',
        padding: '10px 12px',
        verticalAlign: 'top',
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        fontSize: mono ? 12 : 13,
        color: 'var(--c-text)',
      }}
    >
      {children}
    </td>
  )
}
