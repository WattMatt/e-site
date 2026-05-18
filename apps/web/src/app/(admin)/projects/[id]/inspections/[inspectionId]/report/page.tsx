import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import ShareLinkButton from './ShareLinkButton'
import RevokeButton from './RevokeButton'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Certificate' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

interface Props {
  params: Promise<{ id: string; inspectionId: string }>
}

export default async function ReportPage({ params }: Props) {
  const { id: projectId, inspectionId } = await params
  const supabase = (await createClient()) as AnyClient

  // Most recent non-superseded cert (older revisions render via list page in v2).
  const { data: cert } = await supabase
    .schema('inspections')
    .from('certificates')
    .select('*')
    .eq('inspection_id', inspectionId)
    .is('superseded_at', null)
    .maybeSingle()
  if (!cert) notFound()

  const { data: signed } = await supabase.storage
    .from('inspection-certificates')
    .createSignedUrl(cert.storage_path, 3600)

  const isRevoked = !!cert.revoked_at

  return (
    <div className="animate-fadeup" style={{ maxWidth: 1280 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/inspections/${inspectionId}`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← Inspection
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Certificate {cert.coc_number}</h1>
          <p className="page-subtitle">
            Generated {new Date(cert.generated_at ?? cert.created_at).toLocaleString('en-ZA')}
          </p>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Badge variant={isRevoked ? 'danger' : 'success'}>
              {isRevoked ? 'revoked' : 'active'}
            </Badge>
            {cert.share_token && !isRevoked && (
              <Badge variant="info">share link active</Badge>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {signed?.signedUrl && (
            <a
              href={signed.signedUrl}
              download={`${cert.coc_number}.pdf`}
              style={{ textDecoration: 'none' }}
            >
              <Button variant="primary">↓ Download</Button>
            </a>
          )}
          <ShareLinkButton
            certificateId={cert.id}
            existingShareToken={cert.share_token}
            shareExpiresAt={cert.share_expires_at}
          />
          {!isRevoked && (
            <RevokeButton
              certificateId={cert.id}
              inspectionId={inspectionId}
              projectId={projectId}
            />
          )}
        </div>
      </div>

      {isRevoked && (
        <div
          style={{
            fontSize: 13,
            color: 'var(--c-red)',
            background: 'var(--c-red-dim, rgba(192,57,43,0.12))',
            border: '1px solid var(--c-red-dim, rgba(192,57,43,0.3))',
            borderRadius: 8,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <strong>REVOKED</strong> on{' '}
          {new Date(cert.revoked_at).toLocaleString('en-ZA')}
          {cert.revoke_reason && (
            <>
              {' · '}
              <span>Reason: {cert.revoke_reason}</span>
            </>
          )}
        </div>
      )}

      {signed?.signedUrl ? (
        <iframe
          src={signed.signedUrl}
          title={`Certificate ${cert.coc_number}`}
          style={{
            width: '100%',
            height: '80vh',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            background: 'var(--c-panel)',
          }}
        />
      ) : (
        <div
          style={{
            padding: 16,
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            color: 'var(--c-text-dim)',
            fontSize: 13,
          }}
        >
          Could not load the certificate PDF. Try refreshing or contact support.
        </div>
      )}
    </div>
  )
}
