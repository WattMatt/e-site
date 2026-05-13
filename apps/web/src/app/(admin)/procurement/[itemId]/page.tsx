import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { QuoteUploadForm } from './QuoteUploadForm'
import { QuoteCompareTable, type QuoteRow } from './QuoteCompareTable'
import { ShopDrawingsPanel, type ShopDrawingRow } from './ShopDrawingsPanel'
import { GRNPanel, type GRNRow } from './GRNPanel'
import { POButton } from './POButton'
import { SupplierInvoicePanel, type SupplierInvoiceRow } from './SupplierInvoicePanel'

export const metadata: Metadata = { title: 'Procurement item' }

interface Props {
  params: Promise<{ itemId: string }>
}

interface ProcurementItem {
  id: string
  project_id: string
  organisation_id: string
  description: string
  quantity: number | null
  unit: string | null
  status: string
  required_by: string | null
  quoted_price: number | null
  currency: string
  po_number: string | null
  notes: string | null
  schedule_item_id: string | null
  selected_quote_id: string | null
  supplier_id: string | null
  created_at: string
}

interface ScheduleStub {
  id: string
  item_code: string | null
  description: string
  specification: string | null
  quantity: number
  unit: string | null
  instructions: string | null
  shop_drawing_required: boolean
}

interface SupplierStub {
  id: string
  name: string
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  quoted: 'Quoted',
  approved: 'Approved',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
}

function fmtZAR(n: number | null): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 2,
  }).format(n)
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default async function ProcurementItemPage({ params }: Props) {
  const { itemId } = await params
  const supabase = await createClient()

  const { data: itemRow } = await (supabase as any)
    .schema('projects')
    .from('procurement_items')
    .select(
      'id, project_id, organisation_id, description, quantity, unit, status, ' +
      'required_by, quoted_price, currency, po_number, notes, schedule_item_id, ' +
      'selected_quote_id, supplier_id, created_at',
    )
    .eq('id', itemId)
    .single()
  if (!itemRow) notFound()
  const item = itemRow as ProcurementItem

  const [scheduleRes, quotesRes, projectRes, suppliersRes, shopDrawingsRes, grnsRes, invoicesRes] = await Promise.all([
    item.schedule_item_id
      ? (supabase as any)
          .schema('projects')
          .from('engineer_equipment_schedule')
          .select(
            'id, item_code, description, specification, quantity, unit, ' +
            'instructions, shop_drawing_required',
          )
          .eq('id', item.schedule_item_id)
          .single()
      : Promise.resolve({ data: null }),
    (supabase as any)
      .schema('projects')
      .from('procurement_quotes')
      .select(
        'id, supplier_id, supplier_name, quote_reference, quoted_price, ' +
        'currency, valid_until, lead_time_days, notes, file_path, ' +
        'file_size_bytes, file_mime, received_at, is_selected',
      )
      .eq('procurement_item_id', itemId)
      .order('quoted_price', { ascending: true }),
    (supabase as any)
      .schema('projects')
      .from('projects')
      .select('id, name')
      .eq('id', item.project_id)
      .single(),
    (supabase as any)
      .schema('suppliers')
      .from('suppliers')
      .select('id, name')
      .eq('organisation_id', item.organisation_id)
      .order('name'),
    (supabase as any)
      .schema('projects')
      .from('shop_drawings')
      .select(
        'id, title, revision, file_path, file_size_bytes, file_mime, status, notes, submitted_at',
      )
      .eq('procurement_item_id', itemId)
      .order('revision', { ascending: false }),
    (supabase as any)
      .schema('projects')
      .from('goods_received_notes')
      .select(
        'id, delivered_at, quantity_received, condition, notes, photo_paths, signed_pod_path, created_at',
      )
      .eq('procurement_item_id', itemId)
      .order('delivered_at', { ascending: false }),
    (supabase as any)
      .schema('projects')
      .from('supplier_invoices')
      .select(
        'id, invoice_number, supplier_invoice_date, amount, vat_amount, currency, ' +
        'status, paid_at, payment_reference, notes, file_path, file_mime, created_at',
      )
      .eq('procurement_item_id', itemId)
      .order('supplier_invoice_date', { ascending: false }),
  ])

  const schedule = (scheduleRes?.data ?? null) as ScheduleStub | null
  const quotes = ((quotesRes?.data ?? []) as unknown as QuoteRow[])
  const project = (projectRes?.data ?? null) as { id: string; name: string } | null
  const suppliers = ((suppliersRes?.data ?? []) as unknown as SupplierStub[])
  const shopDrawings = ((shopDrawingsRes?.data ?? []) as unknown as ShopDrawingRow[])
  const grns = ((grnsRes?.data ?? []) as unknown as GRNRow[])
  const supplierInvoices = ((invoicesRes?.data ?? []) as unknown as SupplierInvoiceRow[])
  const expectedTotal = item.quantity != null && item.quoted_price != null
    ? Number(item.quantity) * Number(item.quoted_price)
    : null

  // Show Shop Drawings panel when linked schedule line requires one, OR
  // when at least one drawing has already been submitted (covers the case
  // where the engineer changes their mind after submissions started).
  const showShopDrawings =
    !!schedule?.shop_drawing_required || shopDrawings.length > 0

  // PO PDF availability: needs a selected_quote_id. Disabled-with-reason
  // otherwise so the user understands what to do.
  const poDisabledReason = !item.selected_quote_id
    ? 'Select a winning quote first.'
    : undefined

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/procurement${
            project ? `?projectId=${project.id}` : ''
          }`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← Procurement
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{item.description}</h1>
          <p className="page-subtitle">
            {project?.name ?? 'Project'}
            {' · '}
            {STATUS_LABEL[item.status] ?? item.status}
            {item.quantity != null && (
              <> · {Number(item.quantity)}{item.unit ? ` ${item.unit}` : ''}</>
            )}
            {item.required_by && <> · req. by {fmtDate(item.required_by)}</>}
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 280px',
          gap: 16,
          marginBottom: 16,
          alignItems: 'flex-start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Schedule link panel (if linked) */}
          {schedule && (
            <div className="data-panel">
              <div className="data-panel-header">
                <span className="data-panel-title">
                  Linked schedule line
                </span>
                <Link
                  href={`/projects/${item.project_id}/schedule`}
                  className="data-panel-link"
                >
                  View schedule →
                </Link>
              </div>
              <div style={{ padding: '14px 18px' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginBottom: 4 }}>
                  {schedule.item_code ?? '—'}
                </div>
                <div style={{ fontWeight: 600 }}>{schedule.description}</div>
                {schedule.specification && (
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--c-text-dim)',
                      marginTop: 4,
                    }}
                  >
                    {schedule.specification}
                  </div>
                )}
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--c-text-mid)',
                    marginTop: 6,
                  }}
                >
                  Scheduled qty: {Number(schedule.quantity)}{schedule.unit ? ` ${schedule.unit}` : ''}
                </div>
                {schedule.shop_drawing_required && (
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--c-amber)',
                      marginTop: 6,
                    }}
                  >
                    Shop drawing required
                  </div>
                )}
                {schedule.instructions && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '8px 10px',
                      background: 'var(--c-base)',
                      borderRadius: 6,
                      fontSize: 12,
                      color: 'var(--c-text)',
                      fontStyle: 'italic',
                    }}
                  >
                    {schedule.instructions}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Upload + Compare */}
          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">
                Quotes ({quotes.length})
              </span>
            </div>
            <div style={{ padding: '14px 18px' }}>
              <QuoteUploadForm
                procurementItemId={item.id}
                organisationId={item.organisation_id}
                suppliers={suppliers}
              />
              <div style={{ marginTop: 16 }}>
                <QuoteCompareTable
                  procurementItemId={item.id}
                  quotes={quotes}
                  selectedQuoteId={item.selected_quote_id}
                  suppliersById={Object.fromEntries(
                    suppliers.map((s) => [s.id, s.name]),
                  )}
                />
              </div>
            </div>
          </div>

          {/* Shop drawings approval chain */}
          {showShopDrawings && (
            <div className="data-panel">
              <div className="data-panel-header">
                <span className="data-panel-title">
                  Shop drawings ({shopDrawings.length})
                </span>
              </div>
              <div style={{ padding: '14px 18px' }}>
                <ShopDrawingsPanel
                  procurementItemId={item.id}
                  organisationId={item.organisation_id}
                  drawings={shopDrawings}
                />
              </div>
            </div>
          )}

          {/* Goods Received Notes */}
          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">
                Deliveries ({grns.length})
              </span>
            </div>
            <div style={{ padding: '14px 18px' }}>
              <GRNPanel
                procurementItemId={item.id}
                organisationId={item.organisation_id}
                procurementUnit={item.unit}
                procurementQuantity={item.quantity}
                grns={grns}
              />
            </div>
          </div>

          {/* Supplier invoices (AP handoff) */}
          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">
                Supplier invoices ({supplierInvoices.length})
              </span>
            </div>
            <div style={{ padding: '14px 18px' }}>
              <SupplierInvoicePanel
                procurementItemId={item.id}
                organisationId={item.organisation_id}
                invoices={supplierInvoices}
                expectedTotal={expectedTotal}
              />
            </div>
          </div>
        </div>

        {/* Side: item details */}
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Details</span>
          </div>
          <div
            style={{
              padding: '14px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <Detail label="Status" value={STATUS_LABEL[item.status] ?? item.status} />
            <Detail label="Quantity" value={item.quantity == null ? null : `${Number(item.quantity)}${item.unit ? ` ${item.unit}` : ''}`} />
            <Detail
              label="Selected price"
              value={item.quoted_price ? fmtZAR(Number(item.quoted_price)) : null}
            />
            <Detail label="PO number" value={item.po_number} />
            <Detail label="Required by" value={fmtDate(item.required_by)} />
            <Detail label="Created" value={fmtDate(item.created_at)} />
            {item.notes && <Detail label="Notes" value={item.notes} multiline />}
            <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12 }}>
              <POButton
                procurementItemId={item.id}
                disabled={!item.selected_quote_id}
                disabledReason={poDisabledReason}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Detail({
  label,
  value,
  multiline,
}: {
  label: string
  value: string | null
  multiline?: boolean
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--c-text-dim)',
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--c-text)',
          whiteSpace: multiline ? 'pre-wrap' : 'normal',
        }}
      >
        {value ?? '—'}
      </div>
    </div>
  )
}
