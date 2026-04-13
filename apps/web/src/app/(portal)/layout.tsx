import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/portal/compliance')

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Minimal portal header */}
      <header className="border-b border-slate-800 bg-slate-900 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white">E-Site</span>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">Client Portal</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-400">{user.email}</span>
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-sm text-slate-400 hover:text-white transition-colors">Sign out</button>
          </form>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  )
}
