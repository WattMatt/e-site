'use server'

/**
 * Purchase Order PDF generation.
 *
 * Builds a single-page PO PDF using pdf-lib from:
 *   - the org's profile (name / address / contact) → letterhead
 *   - the supplier (suppliers.suppliers row OR supplier_name fallback)
 *   - the procurement_item (description, qty, unit, required_by)
 *   - the selected procurement_quote (quoted_price, currency, lead_time,
 *     quote_reference)
 *
 * Returns base64 PDF bytes; the client triggers a download via a hidden
 * anchor (same pattern as the RFI markup PDF export).
 *
 * If the item has no selected_quote_id yet, returns an error — there's
 * nothing meaningful to put on a PO.
 */

import { z } from 'zod'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createClient } from '@/lib/supabase/server'

const uuid = z.string().uuid()

interface OrgProfile {
  name: string
  address: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  phone: string | null
  email: string | null
}

interface ProcurementItemRow {
  id: string
  description: string
  quantity: number | null
  unit: string | null
  required_by: string | null
  status: string
  notes: string | null
  po_number: string | null
  organisation_id: string
  project_id: string
  supplier_id: string | null
  selected_quote_id: string | null
}

interface QuoteRow {
  id: string
  supplier_id: string | null
  supplier_name: string | null
  quote_reference: string | null
  quoted_price: number
  currency: string
  lead_time_days: number | null
  valid_until: string | null
  notes: string | null
}

interface SupplierRow {
  id: string
  name: string
  address: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  contact_email: string | null
  contact_phone: string | null
}

interface ProjectRow {
  id: string
  name: string
  city: string | null
  client_name: string | null
}

function fmtZAR(n: number): string {
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

export async function generatePOPDFAction(
  procurementItemId: string,
): Promise<{ pdfBase64?: string; filename?: string; error?: string }> {
  if (!uuid.safeParse(procurementItemId).success) {
    return { error: 'Invalid procurement item id' }
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: itemRow, error: itemErr } = await (supabase as any)
    .schema('projects')
    .from('procurement_items')
    .select(
      'id, description, quantity, unit, required_by, status, notes, po_number, ' +
      'organisation_id, project_id, supplier_id, selected_quote_id',
    )
    .eq('id', procurementItemId)
    .single()
  if (itemErr || !itemRow) return { error: 'Procurement item not found' }
  const item = itemRow as ProcurementItemRow

  if (!item.selected_quote_id) {
    return {
      error: 'Pick a winning quote first — there is nothing to put on the PO.',
    }
  }

  const [quoteRes, orgRes, projectRes, supplierRes] = await Promise.all([
    (supabase as any)
      .schema('projects')
      .from('procurement_quotes')
      .select(
        'id, supplier_id, supplier_name, quote_reference, quoted_price, currency, ' +
        'lead_time_days, valid_until, notes',
      )
      .eq('id', item.selected_quote_id)
      .single(),
    supabase
      .from('organisations')
      .select('name, address, city, province, postal_code, phone, email')
      .eq('id', item.organisation_id)
      .single(),
    (supabase as any)
      .schema('projects')
      .from('projects')
      .select('id, name, city, client_name')
      .eq('id', item.project_id)
      .single(),
    item.supplier_id
      ? (supabase as any)
          .schema('suppliers')
          .from('suppliers')
          .select('id, name, address, city, province, postal_code, contact_email, contact_phone')
          .eq('id', item.supplier_id)
          .single()
      : Promise.resolve({ data: null }),
  ])

  const quote = quoteRes?.data as QuoteRow | null
  const org = orgRes?.data as OrgProfile | null
  const project = projectRes?.data as ProjectRow | null
  const supplier = supplierRes?.data as SupplierRow | null

  if (!quote) return { error: 'Selected quote not found' }
  if (!org) return { error: 'Organisation profile not found' }

  // Build the PDF
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])  // A4 portrait
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const PAGE_W = page.getWidth()
  const PAGE_H = page.getHeight()
  const MARGIN = 40
  let y = PAGE_H - MARGIN

  // ── Title ─────────────────────────────────────────────────────────
  page.drawText('PURCHASE ORDER', {
    x: MARGIN, y: y - 14,
    size: 16, font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  })
  y -= 22

  // PO number (use item.po_number if set, else fallback ID slice)
  const poNumber = item.po_number ?? `PO-${item.id.slice(0, 8).toUpperCase()}`
  page.drawText(poNumber, {
    x: MARGIN, y: y - 11,
    size: 11, font,
    color: rgb(0.4, 0.4, 0.4),
  })
  page.drawText(`Issued: ${new Date().toLocaleDateString('en-ZA')}`, {
    x: PAGE_W - MARGIN - 150, y: y - 11,
    size: 10, font,
    color: rgb(0.4, 0.4, 0.4),
  })
  y -= 28

  // ── Org letterhead block ──────────────────────────────────────────
  page.drawText('From', {
    x: MARGIN, y,
    size: 9, font: fontBold,
    color: rgb(0.4, 0.4, 0.4),
  })
  y -= 12
  page.drawText(org.name, { x: MARGIN, y, size: 11, font: fontBold })
  y -= 13
  const orgAddrLines = [
    org.address,
    [org.city, org.province, org.postal_code].filter(Boolean).join(', '),
    org.phone,
    org.email,
  ].filter((l): l is string => !!l && l.trim().length > 0)
  for (const line of orgAddrLines) {
    page.drawText(line, { x: MARGIN, y, size: 9, font, color: rgb(0.3, 0.3, 0.3) })
    y -= 11
  }
  y -= 4

  // ── Supplier block ────────────────────────────────────────────────
  const supLeft = PAGE_W / 2
  let supY = PAGE_H - MARGIN - 28 - 28  // align with org block top
  page.drawText('To', {
    x: supLeft, y: supY,
    size: 9, font: fontBold,
    color: rgb(0.4, 0.4, 0.4),
  })
  supY -= 12
  const supName = supplier?.name ?? quote.supplier_name ?? '(supplier not specified)'
  page.drawText(supName, { x: supLeft, y: supY, size: 11, font: fontBold })
  supY -= 13
  const supAddrLines = supplier
    ? [
        supplier.address,
        [supplier.city, supplier.province, supplier.postal_code].filter(Boolean).join(', '),
        supplier.contact_phone,
        supplier.contact_email,
      ].filter((l): l is string => !!l && l.trim().length > 0)
    : []
  for (const line of supAddrLines) {
    page.drawText(line, { x: supLeft, y: supY, size: 9, font, color: rgb(0.3, 0.3, 0.3) })
    supY -= 11
  }

  // Move y past whichever block is lower
  y = Math.min(y, supY) - 16

  // ── Project / quote reference ─────────────────────────────────────
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.5,
    color: rgb(0.85, 0.85, 0.85),
  })
  y -= 14
  const refLines: string[] = []
  if (project) refLines.push(`Project: ${project.name}${project.city ? ` · ${project.city}` : ''}`)
  if (project?.client_name) refLines.push(`Client: ${project.client_name}`)
  if (quote.quote_reference) refLines.push(`Quote ref: ${quote.quote_reference}`)
  if (item.required_by) refLines.push(`Required by: ${fmtDate(item.required_by)}`)
  if (quote.lead_time_days != null) refLines.push(`Lead time: ${quote.lead_time_days} day${quote.lead_time_days === 1 ? '' : 's'}`)
  for (const line of refLines) {
    page.drawText(line, { x: MARGIN, y, size: 9, font, color: rgb(0.2, 0.2, 0.2) })
    y -= 11
  }
  y -= 8

  // ── Line item table ───────────────────────────────────────────────
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.5,
    color: rgb(0.85, 0.85, 0.85),
  })
  y -= 14
  // Header row
  page.drawText('Description', { x: MARGIN, y, size: 9, font: fontBold, color: rgb(0.4, 0.4, 0.4) })
  page.drawText('Qty', { x: PAGE_W - MARGIN - 180, y, size: 9, font: fontBold, color: rgb(0.4, 0.4, 0.4) })
  page.drawText('Unit price', { x: PAGE_W - MARGIN - 120, y, size: 9, font: fontBold, color: rgb(0.4, 0.4, 0.4) })
  page.drawText('Total', { x: PAGE_W - MARGIN - 50, y, size: 9, font: fontBold, color: rgb(0.4, 0.4, 0.4) })
  y -= 12
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.3,
    color: rgb(0.85, 0.85, 0.85),
  })
  y -= 14

  // Item row (wraps description across multiple lines if long)
  const wrapWidth = PAGE_W - MARGIN * 2 - 220
  const descLines = wrapLines(item.description, wrapWidth, font, 10)
  for (let i = 0; i < descLines.length; i++) {
    page.drawText(descLines[i]!, { x: MARGIN, y, size: 10, font })
    if (i === 0) {
      const qtyStr = item.quantity != null
        ? `${Number(item.quantity)}${item.unit ? ` ${item.unit}` : ''}`
        : '—'
      const totalPrice = item.quantity != null
        ? Number(item.quantity) * Number(quote.quoted_price)
        : Number(quote.quoted_price)
      page.drawText(qtyStr, { x: PAGE_W - MARGIN - 180, y, size: 10, font })
      page.drawText(fmtZAR(Number(quote.quoted_price)), { x: PAGE_W - MARGIN - 120, y, size: 10, font })
      page.drawText(fmtZAR(totalPrice), { x: PAGE_W - MARGIN - 50, y, size: 10, font: fontBold })
    }
    y -= 12
  }

  if (item.notes) {
    y -= 4
    const noteLines = wrapLines(`Notes: ${item.notes}`, PAGE_W - MARGIN * 2, font, 9)
    for (const line of noteLines) {
      page.drawText(line, { x: MARGIN, y, size: 9, font, color: rgb(0.3, 0.3, 0.3) })
      y -= 11
    }
  }

  // ── Total ─────────────────────────────────────────────────────────
  y -= 10
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.5,
    color: rgb(0.85, 0.85, 0.85),
  })
  y -= 14
  const total = item.quantity != null
    ? Number(item.quantity) * Number(quote.quoted_price)
    : Number(quote.quoted_price)
  page.drawText('Total (excl. VAT)', { x: PAGE_W - MARGIN - 200, y, size: 10, font: fontBold })
  page.drawText(fmtZAR(total), { x: PAGE_W - MARGIN - 80, y, size: 12, font: fontBold, color: rgb(0.1, 0.1, 0.1) })
  y -= 22

  // ── Footer note ───────────────────────────────────────────────────
  page.drawText(
    'This Purchase Order is issued in terms of the quoted price and lead time. Deliveries to be accompanied by a delivery note matching this PO number.',
    { x: MARGIN, y: MARGIN + 24, size: 8, font, color: rgb(0.4, 0.4, 0.4), maxWidth: PAGE_W - MARGIN * 2 },
  )

  // Signature block
  page.drawLine({
    start: { x: MARGIN, y: MARGIN + 10 },
    end: { x: MARGIN + 180, y: MARGIN + 10 },
    thickness: 0.5,
    color: rgb(0.6, 0.6, 0.6),
  })
  page.drawText('Authorised signature', {
    x: MARGIN, y: MARGIN,
    size: 8, font, color: rgb(0.5, 0.5, 0.5),
  })
  page.drawLine({
    start: { x: PAGE_W - MARGIN - 180, y: MARGIN + 10 },
    end: { x: PAGE_W - MARGIN, y: MARGIN + 10 },
    thickness: 0.5,
    color: rgb(0.6, 0.6, 0.6),
  })
  page.drawText('Date', {
    x: PAGE_W - MARGIN - 180, y: MARGIN,
    size: 8, font, color: rgb(0.5, 0.5, 0.5),
  })

  const bytes = await pdf.save()
  // Convert to base64 — use a chunk loop to avoid blowing the stack on
  // larger documents (this one is small but cheap to be safe).
  let binary = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)))
  }
  const pdfBase64 = btoa(binary)

  return {
    pdfBase64,
    filename: `${poNumber}.pdf`,
  }
}

/**
 * Naive word-wrap for pdf-lib (no built-in measureText paragraph layout).
 * Splits on whitespace and accumulates until the line width exceeds limit.
 */
function wrapLines(
  text: string,
  maxWidth: number,
  font: import('pdf-lib').PDFFont,
  fontSize: number,
): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w
    if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && current) {
      lines.push(current)
      current = w
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}
