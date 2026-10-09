import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Tender', robots: { index: false, follow: false } }

/**
 * Tenderer portal chrome (E5 slice B): no app navigation. A tenderer has no
 * organisation and sees nothing of E-Site beyond the tenders they were invited to.
 * Signed in, they see who they are and can sign out (a site-office computer is
 * often shared); signing out returns them to /tender/login.
 */
export default async function TenderLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return (
    <div style={{ minHeight: '100vh', background: 'var(--c-base, #f8fafc)', color: 'var(--c-text, #0f172a)', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <main style={{ maxWidth: 1080, margin: '0 auto', display: 'grid', gap: 16 }}>
        {user?.email && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span>Signed in as {user.email}</span>
            <form action="/auth/signout" method="post">
              <input type="hidden" name="to" value="/tender/login" />
              <button type="submit" className="btn btn-sm">Sign out</button>
            </form>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
