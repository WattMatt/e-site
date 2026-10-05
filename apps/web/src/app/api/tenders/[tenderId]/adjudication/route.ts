import { NextResponse } from 'next/server'
import { loadAdjudication } from '@/lib/tender/load-adjudication'
import { buildAdjudicationWorkbook } from '@/lib/tender/adjudication-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/tenders/[tenderId]/adjudication — the adjudication workbook.
 * Owner/admin/PM of the tender's project only (gateTender), and only once the
 * database has lifted the seal (the bids are read through the caller's session).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ tenderId: string }> }) {
  const { tenderId } = await params
  const res = await loadAdjudication(tenderId)
  if (!res.ok) {
    const status = res.error === 'Tender not found' ? 404 : /sealed/.test(res.error) ? 409 : 403
    return NextResponse.json({ error: res.error }, { status })
  }
  const { adjudication, tender, projectName } = res.data
  const bytes = await buildAdjudicationWorkbook(adjudication, {
    project: projectName,
    tender: `${tender.package} — ${tender.title}`,
    closedAt: tender.closing_at,
  })
  const name = `${projectName} - ${tender.package} - adjudication.xlsx`.replace(/[^A-Za-z0-9 ._()-]+/g, '_')
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  })
}
