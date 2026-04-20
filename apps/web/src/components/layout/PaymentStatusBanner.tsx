import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AlertTriangle } from 'lucide-react'

// Server component — queries the viewer's org subscription once per admin-layout
// render and shows a banner when payment is in trouble. Rendered in the
// (admin) layout so every admin page shows it.
//
// Spec: spec-v2.md §18 (payment recovery sequence). Renders nothing when the
// subscription is healthy or when there's no subscription at all (free tier).

type Status = 'active' | 'trialing' | 'past_due' | 'grace_period' | 'paused' | 'cancelled'

const MESSAGES: Partial<Record<Status, { title: string; body: string; cta: string; tone: 'warn' | 'danger' }>> = {
  past_due: {
    title: 'Payment failed',
    body: 'We’ll retry automatically over the next few days. Update your card early to avoid interruptions.',
    cta: 'Update card',
    tone: 'warn',
  },
  grace_period: {
    title: 'Final warning — account access restricted soon',
    body: 'Payment has been failing for a week. Projects will go read-only in 7 days unless we can charge your card.',
    cta: 'Update card now',
    tone: 'danger',
  },
  paused: {
    title: 'Account paused — read-only mode',
    body: 'Projects are now read-only. Update your card to restore full access. Data is preserved.',
    cta: 'Restore access',
    tone: 'danger',
  },
}

export async function PaymentStatusBanner() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: membership } = await (supabase as any)
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  const orgId = (membership as { organisation_id: string } | null)?.organisation_id
  if (!orgId) return null

  const { data: sub } = await (supabase as any)
    .schema('billing')
    .from('subscriptions')
    .select('status')
    .eq('organisation_id', orgId)
    .maybeSingle()

  const status = (sub as { status: Status } | null)?.status
  if (!status) return null
  const message = MESSAGES[status]
  if (!message) return null

  const tone = message.tone === 'danger'
    ? { bg: 'var(--c-red-dim)', fg: 'var(--c-red)', border: 'rgba(232,85,85,0.35)' }
    : { bg: 'var(--c-amber-dim)', fg: 'var(--c-amber)', border: 'var(--c-amber-mid)' }

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 16px',
        margin: '0 24px 16px',
        background: tone.bg,
        color: tone.fg,
        border: `1px solid ${tone.border}`,
        borderRadius: 6,
        fontSize: 13,
      }}
    >
      <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>{message.title}</div>
        <div style={{ color: 'var(--c-text-mid)', lineHeight: 1.5 }}>{message.body}</div>
      </div>
      <Link
        href="/settings/billing"
        style={{
          flexShrink: 0,
          padding: '6px 14px',
          background: tone.fg,
          color: 'var(--c-base)',
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 700,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {message.cta}
      </Link>
    </div>
  )
}
