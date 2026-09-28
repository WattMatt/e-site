import type { SupabaseClient } from '@supabase/supabase-js'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { ErrorReportList, type ErrorReportRow } from './ErrorReportList'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export default async function ReportsPage() {
  const { supabase } = await requirePlatformTariffAdminPage()
  const { data } = await supabase.schema('tariffs').from('error_report')
    .select('id, note, status, resolution_note, created_at, resolved_at, project_id, tariff:tariff_id(id, name, tariff_year:tariff_year_id(financial_year, licensee:licensee_id(name)))')
    .order('created_at', { ascending: false }).limit(200)
  const rows = (data ?? []) as Row[]
  // Project names: the admin is not a member of these projects, so RLS hides
  // them; read the NAME only, with the service client, after the gate.
  const ids = [...new Set(rows.map((r) => String(r.project_id)))]
  const names = new Map<string, string>()
  if (ids.length) {
    const svc = createServiceClient() as unknown as AnyClient
    const { data: ps } = await svc.schema('projects').from('projects').select('id, name').in('id', ids)
    for (const p of (ps ?? []) as Array<{ id: string; name: string }>) names.set(p.id, p.name)
  }
  const list: ErrorReportRow[] = rows.map((r) => {
    const t = r.tariff as { name: string; tariff_year: { financial_year: string; licensee: { name: string } | null } | null } | null
    return {
      id: String(r.id), note: String(r.note), status: String(r.status), resolutionNote: (r.resolution_note as string | null) ?? '',
      createdAt: String(r.created_at), project: names.get(String(r.project_id)) ?? 'Unknown project',
      tariff: t ? `${t.tariff_year?.licensee?.name ?? ''} ${t.tariff_year?.financial_year ?? ''} · ${t.name}` : 'Unknown tariff',
    }
  })
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Reported tariff errors</span></CardHeader>
      <CardBody>{list.length === 0 ? <p style={{ fontSize: 13 }}>No reports. Users report errors from a project's Tariff tab.</p> : <ErrorReportList rows={list} />}</CardBody>
    </Card>
  )
}
