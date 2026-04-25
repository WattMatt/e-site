import { InDevelopmentNotice, isMarketplaceEnabled } from '@/components/marketplace/InDevelopmentNotice'

/**
 * Phase 1 launch gate. When the feature flag is off (default), every
 * /marketplace/* route under the admin shell renders the InDevelopmentNotice
 * instead of its actual page.
 *
 * Flip on with: NEXT_PUBLIC_PHASE_2_MARKETPLACE=true (Vercel env var).
 */
export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  if (!isMarketplaceEnabled()) {
    return <InDevelopmentNotice backHref="/dashboard" backLabel="Back to dashboard" />
  }
  return <>{children}</>
}
