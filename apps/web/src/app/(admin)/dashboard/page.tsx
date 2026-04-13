import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-white mb-2">Dashboard</h1>
      <p className="text-slate-400">Welcome back, {user?.email}</p>

      {/* Sprint 1: replace with real KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        {['Active Projects', 'Open Snags', 'Pending COCs'].map((label) => (
          <div key={label} className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <p className="text-slate-400 text-sm">{label}</p>
            <p className="text-3xl font-bold text-white mt-2">—</p>
          </div>
        ))}
      </div>
    </div>
  )
}
