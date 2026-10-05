import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isPlatformTariffAdmin, type AnyClient } from '@/lib/tariffs/admin-gate'
import { tariffMapEnabled } from '@/lib/tariffs/map-flag'
import { TariffsNav } from './_components/TariffsNav'

export const dynamic = 'force-dynamic'

/**
 * Tariffs (E7): the published NERSA-approved library for every signed-in
 * organisation (D1, 2026-10-05). The (admin) layout already bounces client
 * viewers to /portal; RLS (00228) decides what each caller reads.
 */
export default async function TariffsLayout({ children }: { children: React.ReactNode }) {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/tariffs')
  const admin = await isPlatformTariffAdmin(supabase)
  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tariffs</h1>
          <p className="page-subtitle">NERSA-approved electricity tariffs, cited to the document they were read from</p>
        </div>
      </div>
      <TariffsNav mapEnabled={tariffMapEnabled()} tariffAdmin={admin} />
      <div style={{ marginTop: 16 }}>{children}</div>
    </div>
  )
}
