import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { AdminTariffNav } from './_components/AdminTariffNav'

export const dynamic = 'force-dynamic'

/**
 * Platform tariff library (spec §12; D-03). 404 for anyone not on the
 * platform_tariff_admins allow-list (00209). Every page and action re-checks.
 */
export default async function TariffLibraryLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformTariffAdminPage()
  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tariff library</h1>
          <p className="page-subtitle">The published South African tariffs every Solar study reads</p>
        </div>
      </div>
      <AdminTariffNav />
      <div style={{ marginTop: 16 }}>{children}</div>
    </div>
  )
}
