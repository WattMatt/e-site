import type { Metadata } from 'next'
import Link from 'next/link'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRolePage } from '@/lib/auth/require-role'
import { OWNER_ADMIN } from '@esite/shared'
import { BrandingForm } from './BrandingForm'

export const metadata: Metadata = { title: 'Branding & Letterhead · Settings' }

const LOGO_BUCKET = 'report-logos'

export default async function BrandingSettingsPage() {
  // Org-level surface — owner/admin only. Redirects on failure.
  const ctx = await requireRolePage(OWNER_ADMIN)

  const supabase = await createClient()
  // signatory_* / report_accent_color aren't in the generated `organisations`
  // types yet, so read through an untyped client (same cast the actions use).
  const { data: org } = await (supabase as any)
    .from('organisations')
    .select(
      'id, name, address, city, province, registration_number, vat_number, phone, website, signatory_name, signatory_title, logo_url, report_accent_color',
    )
    .eq('id', ctx.organisationId)
    .single()

  // The report-logos bucket is private — sign a short-lived URL so the current
  // logo can be previewed.
  let logoUrl: string | null = null
  if (org?.logo_url) {
    const service = createServiceClient()
    const { data: signed } = await service.storage
      .from(LOGO_BUCKET)
      .createSignedUrl(org.logo_url, 60 * 60)
    logoUrl = signed?.signedUrl ?? null
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div className="page-header">
        <Link
          href="/settings"
          style={{
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          ← Settings
        </Link>
        <h1 className="page-title">Branding &amp; Letterhead</h1>
      </div>

      <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 18, lineHeight: 1.6 }}>
        These details form the branded letterhead used on generated JBCC notice
        letters and exported reports. Fill in your organisation&apos;s
        particulars and upload a logo — the preview below updates as you type.
      </p>

      <BrandingForm
        orgId={org?.id ?? ctx.organisationId}
        name={org?.name ?? ''}
        address={org?.address ?? ''}
        city={org?.city ?? ''}
        province={org?.province ?? ''}
        registrationNumber={org?.registration_number ?? ''}
        vatNumber={org?.vat_number ?? ''}
        phone={org?.phone ?? ''}
        website={org?.website ?? ''}
        signatoryName={org?.signatory_name ?? ''}
        signatoryTitle={org?.signatory_title ?? ''}
        reportAccentColor={org?.report_accent_color ?? ''}
        hasLogo={Boolean(org?.logo_url)}
        logoUrl={logoUrl}
      />
    </div>
  )
}
