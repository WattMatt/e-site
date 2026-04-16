import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { NotificationCentre } from '@/components/ui/NotificationCentre'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-slate-950 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b border-slate-800 flex items-center justify-end px-6 flex-shrink-0 bg-slate-950">
          <NotificationCentre />
        </header>
        <main className="flex-1 overflow-auto p-8">{children}</main>
      </div>
    </div>
  )
}
