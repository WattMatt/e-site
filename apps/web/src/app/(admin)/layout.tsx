import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Sidebar placeholder — built in next sprint */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex-shrink-0" />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
