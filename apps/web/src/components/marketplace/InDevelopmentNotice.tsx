import Link from 'next/link'
import { Wrench } from 'lucide-react'

/**
 * Phase 1 placeholder for marketplace routes. Marketplace is Phase 2 per
 * the build plan — its code is merged but not user-facing at launch.
 *
 * Rendered by:
 *   apps/web/src/app/(admin)/marketplace/layout.tsx
 *   apps/web/src/app/(marketplace)/layout.tsx
 *
 * Gate: enabled iff `process.env.NEXT_PUBLIC_PHASE_2_MARKETPLACE === 'true'`
 */
export function InDevelopmentNotice({
  backHref = '/dashboard',
  backLabel = 'Back to dashboard',
}: {
  backHref?: string
  backLabel?: string
}) {
  return (
    <div className="animate-fadeup" style={{ maxWidth: 560, margin: '64px auto', padding: '0 24px' }}>
      <div
        className="data-panel"
        style={{
          padding: 32,
          border: '1px dashed var(--c-amber-mid)',
          background: 'var(--c-amber-dim)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            borderRadius: 12,
            background: 'var(--c-base)',
            border: '1px solid var(--c-amber-mid)',
            marginBottom: 18,
          }}
        >
          <Wrench size={24} color="var(--c-amber)" />
        </div>

        <div
          style={{
            display: 'inline-block',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--c-amber)',
            background: 'var(--c-base)',
            border: '1px solid var(--c-amber-mid)',
            padding: '3px 8px',
            borderRadius: 3,
            marginBottom: 14,
          }}
        >
          In Development
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--c-text)', margin: '0 0 12px', lineHeight: 1.25 }}>
          Marketplace is launching in Phase 2
        </h1>

        <p style={{ fontSize: 14, color: 'var(--c-text-mid)', margin: '0 0 8px', lineHeight: 1.5 }}>
          The supplier marketplace, catalogue, and ordering flow are built but not yet open to contractors.
          We&apos;re holding it back until the Paystack settlement model and supplier onboarding are validated.
        </p>
        <p style={{ fontSize: 13, color: 'var(--c-text-dim)', margin: '0 0 24px' }}>
          Want early access? Email <a href="mailto:hello@e-site.co.za" style={{ color: 'var(--c-amber)' }}>hello@e-site.co.za</a>.
        </p>

        <Link
          href={backHref}
          className="btn-primary-amber"
          style={{ display: 'inline-block', textDecoration: 'none' }}
        >
          ← {backLabel}
        </Link>
      </div>
    </div>
  )
}

/** Server-only feature flag check. Default: disabled. */
export function isMarketplaceEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PHASE_2_MARKETPLACE === 'true'
}
