/**
 * Public share route — anonymous visitors view a certificate PDF via a
 * time-limited share token. Lives OUTSIDE the (admin) route group so the
 * admin layout (sidebar, nav chrome) is not rendered.
 *
 * Auth: NONE. Uses a service-role Supabase client because anonymous users
 * cannot read inspections.certificates rows under RLS. Token validation is
 * explicit: share_token must match AND share_expires_at > now() AND
 * revoked_at IS NULL. Any failure renders Next's notFound() page rather
 * than leaking whether a token exists vs is expired vs is revoked.
 *
 * The middleware allows /inspection through (added to PUBLIC_PATHS).
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Certificate' }

interface Props {
  params: Promise<{ shareToken: string }>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

async function lookupCertByShareToken(
  shareToken: string,
): Promise<{ cocNumber: string; signedUrl: string | null } | null> {
  // Service role bypasses RLS — required because anon visitors can't read
  // inspections.certificates. Token validation is enforced explicitly below.
  const sb = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  ) as AnyClient

  const { data } = await sb
    .schema('inspections')
    .from('certificates')
    .select('id, coc_number, storage_path, share_expires_at, revoked_at')
    .eq('share_token', shareToken)
    .maybeSingle()

  if (!data) return null
  if (data.revoked_at) return null
  if (!data.share_expires_at || new Date(data.share_expires_at) < new Date()) return null

  const { data: signed } = await sb.storage
    .from('inspection-certificates')
    .createSignedUrl(data.storage_path, 3600)

  return { cocNumber: data.coc_number, signedUrl: signed?.signedUrl ?? null }
}

export default async function PublicCertPage({ params }: Props) {
  const { shareToken } = await params
  const cert = await lookupCertByShareToken(shareToken)
  if (!cert) notFound()

  return (
    <div style={{ minHeight: '100vh', padding: 16, background: 'var(--c-base)' }}>
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          background: 'var(--c-panel)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--c-text)', margin: 0 }}>
              Certificate {cert.cocNumber}
            </h1>
            <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: '4px 0 0' }}>
              Shared via E-Site · Read-only public view
            </p>
          </div>
          {cert.signedUrl && (
            <a
              href={cert.signedUrl}
              download={`${cert.cocNumber}.pdf`}
              style={{
                display: 'inline-block',
                background: 'var(--c-blue)',
                color: '#fff',
                textDecoration: 'none',
                padding: '8px 16px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              ↓ Download PDF
            </a>
          )}
        </div>

        {cert.signedUrl ? (
          <iframe
            src={cert.signedUrl}
            title={`Certificate ${cert.cocNumber}`}
            style={{
              width: '100%',
              height: '85vh',
              border: '1px solid var(--c-border)',
              borderRadius: 6,
              background: 'var(--c-elevated)',
            }}
          />
        ) : (
          <div
            style={{
              padding: 16,
              border: '1px solid var(--c-border)',
              borderRadius: 6,
              color: 'var(--c-text-mid)',
              fontSize: 13,
            }}
          >
            Certificate file unavailable. Please contact the issuing organisation.
          </div>
        )}
      </div>
    </div>
  )
}
