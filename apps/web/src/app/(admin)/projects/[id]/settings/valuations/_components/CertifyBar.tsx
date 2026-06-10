'use client'

/**
 * CertifyBar — certify a draft valuation, or (once certified) view its
 * Payment Certificate PDF.
 *
 * Draft: a two-step inline-confirm "Certify" button (the same arm-then-commit
 * pattern the app uses elsewhere — Safari silently suppresses window.confirm).
 * Certifying freezes the figures + renders + persists the PDF
 * (certifyValuationAction), then onChanged() re-fetches so the whole detail
 * flips read-only. Certified: a locked banner + a "View certificate" link that
 * opens the PDF via a signed URL inside the click gesture (previewViaSignedUrl).
 */

import { useState } from 'react'
import type { Valuation } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { certifyValuationAction, getValuationReportUrlAction } from '@/actions/valuation.actions'
import { previewViaSignedUrl } from '@/lib/file-open'

interface Props {
  projectId: string
  valuation: Valuation
  canEdit: boolean
  /** Resolved certifier display name (from getValuationAction), if certified. */
  certifiedByName: string | null
  /** Re-fetch the valuation after certifying. */
  onChanged: () => void
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function CertifyBar({ projectId, valuation, canEdit, certifiedByName, onChanged }: Props) {
  const [arming, setArming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function viewCertificate() {
    setError(null)
    const res = await previewViaSignedUrl(async () => {
      const r = await getValuationReportUrlAction(projectId, valuation.id)
      return 'error' in r ? { error: r.error } : { url: r.data.url }
    })
    if (res.error) setError(res.error)
  }

  // ── Certified: locked banner + view link ──────────────────────────────────
  if (valuation.status === 'certified') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          borderRadius: 8,
          padding: '12px 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Badge variant="success">certified</Badge>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)' }}>
            {certifiedByName ? `by ${certifiedByName}` : ''}
            {valuation.certifiedAt ? ` · ${fmtDateTime(valuation.certifiedAt)}` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {error && <span style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</span>}
          <Button variant="secondary" size="sm" onClick={viewCertificate}>
            View certificate
          </Button>
        </div>
      </div>
    )
  }

  // ── Draft: certify (two-step confirm) ──────────────────────────────────────
  if (!canEdit) return null

  async function doCertify() {
    setBusy(true)
    setError(null)
    const res = await certifyValuationAction(projectId, valuation.id)
    setBusy(false)
    setArming(false)
    if ('error' in res) {
      setError(res.error)
      return
    }
    onChanged()
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        background: 'var(--c-panel)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: '12px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Badge variant="warning">draft</Badge>
        <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
          Certifying locks the figures and generates the Payment Certificate PDF.
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {error && <span style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</span>}
        {arming ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setArming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" isLoading={busy} disabled={busy} onClick={doCertify}>
              {busy ? 'Certifying…' : 'Confirm certify'}
            </Button>
          </>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setArming(true)}>
            Certify
          </Button>
        )}
      </div>
    </div>
  )
}
