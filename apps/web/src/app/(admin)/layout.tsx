import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { NotificationCentre } from '@/components/ui/NotificationCentre'
import { PaymentStatusBanner } from '@/components/layout/PaymentStatusBanner'
import { MinimalLegalNav } from '@/components/layout/MinimalLegalNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="portal-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <header className="portal-header">
          <NotificationCentre />
        </header>
        <main id="main-content" className="portal-main">
          <PaymentStatusBanner />
          {children}
          <MinimalLegalNav />
        </main>
      </div>
    </div>
  )
}
