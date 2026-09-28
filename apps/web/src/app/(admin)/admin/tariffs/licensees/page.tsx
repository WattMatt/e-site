import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { LicenseeEditor, type LicenseeRow } from './LicenseeEditor'

export const dynamic = 'force-dynamic'

export default async function LicenseesPage() {
  const { supabase } = await requirePlatformTariffAdminPage()
  const { data } = await supabase.schema('tariffs').from('licensee')
    .select('id, name, kind, mdb_code, province, nersa_licence_no, updated_at, licensee_alias(alias)').order('name')
  const rows: LicenseeRow[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), name: String(r.name), kind: String(r.kind), mdbCode: (r.mdb_code as string | null) ?? '',
    province: (r.province as string | null) ?? '', nersaLicenceNo: (r.nersa_licence_no as string | null) ?? '',
    updatedAt: String(r.updated_at), aliases: ((r.licensee_alias ?? []) as Array<{ alias: string }>).map((a) => a.alias).sort(),
  }))
  return <LicenseeEditor rows={rows} />
}
