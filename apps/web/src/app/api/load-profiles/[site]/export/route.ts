/**
 * GET /api/load-profiles/[site]/export?format=xlsx|pdf&year=&pf=
 * Gate: ARCHIVE_READ_ROLES on the caller's organisation; reads through the caller's session (Solar RLS).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireRoleAPI } from '@/lib/auth/require-role'
import { createClient } from '@/lib/supabase/server'
import { ARCHIVE_READ_ROLES } from '@/lib/load-profile/access'
import { archiveSettings, loadArchiveSiteView, siteFromParam } from '@/lib/load-profile/archive'
import { buildExportModel } from '@/lib/load-profile/export-model'
import { renderLoadProfilePdf } from '@/lib/load-profile/export-pdf'
import { buildLoadProfileWorkbook } from '@/lib/load-profile/export-xlsx'
import type { AnyClient } from '@/lib/load-profile/load'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const safeName = (s: string) => s.replace(/[^A-Za-z0-9 ._-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'site'

export async function GET(req: NextRequest, { params }: { params: Promise<{ site: string }> }) {
  const format = req.nextUrl.searchParams.get('format')
  if (format !== 'xlsx' && format !== 'pdf') return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const gate = await requireRoleAPI(ARCHIVE_READ_ROLES)
  if (!gate.ok) return gate.response
  const site = siteFromParam((await params).site)
  const settings = archiveSettings({ year: req.nextUrl.searchParams.get('year') ?? undefined, pf: req.nextUrl.searchParams.get('pf') ?? undefined })
  const supabase = (await createClient()) as unknown as AnyClient
  const view = await loadArchiveSiteView(supabase, site, { ...settings, includeHourly: format === 'xlsx' })
  if (!view || !view.analysis) return NextResponse.json({ error: 'No load profile for this site.' }, { status: 404 })
  const model = buildExportModel(view, new Date())
  const base = `load-profile-${safeName(site)}-${settings.referenceYear}`
  if (format === 'xlsx') {
    return new NextResponse(new Uint8Array(await buildLoadProfileWorkbook(model)), {
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${base}.xlsx"`, 'cache-control': 'private, no-store' },
    })
  }
  return new NextResponse(new Uint8Array(await renderLoadProfilePdf(model)), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${base}.pdf"`, 'cache-control': 'private, no-store' },
  })
}
