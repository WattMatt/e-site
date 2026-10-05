/**
 * GET /api/projects/[id]/load-profile/export?format=xlsx|pdf
 * Gate: LOAD_PROFILE_READ_ROLES on the project (effective role). Reads through the caller's session,
 * so 00224's RLS is the second gate; tariffs come from published years only (tariff-source).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { LOAD_PROFILE_READ_ROLES } from '@/lib/load-profile/access'
import { buildExportModel } from '@/lib/load-profile/export-model'
import { renderLoadProfilePdf } from '@/lib/load-profile/export-pdf'
import { buildLoadProfileWorkbook } from '@/lib/load-profile/export-xlsx'
import { loadLoadProfileView, type AnyClient } from '@/lib/load-profile/load'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const safeName = (s: string) => s.replace(/[^A-Za-z0-9 ._-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'project'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const format = req.nextUrl.searchParams.get('format')
  if (!UUID.test(id) || (format !== 'xlsx' && format !== 'pdf')) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const supabase = (await createClient()) as unknown as AnyClient
  const gate = await requireEffectiveRole(supabase, id, LOAD_PROFILE_READ_ROLES)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.error === 'Not authenticated' ? 401 : 403 })

  const view = await loadLoadProfileView(supabase, id, { canEdit: false, includeHourly: format === 'xlsx' })
  if (!view.analysis) return NextResponse.json({ error: 'No load profile to export yet.' }, { status: 404 })
  const model = buildExportModel(view, new Date())
  const base = `load-profile-${safeName(view.projectName)}-${view.settings.referenceYear}`
  if (format === 'xlsx') {
    const body = await buildLoadProfileWorkbook(model)
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${base}.xlsx"`,
        'cache-control': 'private, no-store',
      },
    })
  }
  const body = await renderLoadProfilePdf(model)
  return new NextResponse(new Uint8Array(body), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${base}.pdf"`, 'cache-control': 'private, no-store' },
  })
}
