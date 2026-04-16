import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-lg font-bold text-white">E-Site</Link>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">Supplier Portal</span>
        </div>
        <nav className="flex items-center gap-4">
          {user ? (
            <>
              <Link href="/supplier/profile" className="text-sm text-slate-400 hover:text-white transition-colors">Profile</Link>
              <Link href="/supplier/catalogue" className="text-sm text-slate-400 hover:text-white transition-colors">Catalogue</Link>
              <Link href="/supplier/orders" className="text-sm text-slate-400 hover:text-white transition-colors">Orders</Link>
              <span className="text-slate-700">|</span>
              <span className="text-sm text-slate-400">{user.email}</span>
              <form action="/auth/signout" method="post">
                <button type="submit" className="text-sm text-slate-400 hover:text-white transition-colors">Sign out</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="text-sm text-slate-400 hover:text-white transition-colors">Log in</Link>
              <Link
                href="/register"
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                Register
              </Link>
            </>
          )}
        </nav>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  )
}
