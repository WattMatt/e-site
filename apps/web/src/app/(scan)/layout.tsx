import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Minimal chrome-free layout for the QR-scan landing path. No sidebar,
 * no header — just a centred container so a field worker scanning a
 * printed cable tag with a phone camera lands on something mobile-
 * friendly. Auth-required (redirects to /login; the page-level redirect
 * to the original URL is handled by Next's natural navigation after
 * sign-in).
 */
export default async function ScanLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login?next=/site')
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--c-bg, #fff)',
      color: 'var(--c-text, #111)',
      padding: '24px 16px',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  )
}
