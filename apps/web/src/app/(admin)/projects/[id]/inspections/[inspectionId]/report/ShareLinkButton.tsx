'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { generateShareLinkAction } from '@/actions/inspections-certify.actions'

export default function ShareLinkButton({
  certificateId,
  existingShareToken,
  shareExpiresAt,
}: {
  certificateId: string
  existingShareToken: string | null
  shareExpiresAt: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(existingShareToken)

  const onClick = async () => {
    setFeedback(null)
    setBusy(true)
    try {
      // Reuse an existing non-expired token if present; otherwise mint a fresh one.
      const stillValid =
        token && shareExpiresAt && new Date(shareExpiresAt) > new Date()
      const newToken = stillValid
        ? (token as string)
        : await generateShareLinkAction({ certificateId })
      setToken(newToken)
      const url = `${window.location.origin}/inspection/${newToken}`
      await navigator.clipboard.writeText(url)
      setFeedback('Link copied to clipboard')
    } catch (e) {
      setFeedback(`Failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
      setTimeout(() => setFeedback(null), 4000)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <Button variant="secondary" onClick={onClick} disabled={busy}>
        {busy ? 'Working…' : token ? 'Copy share link' : '↗ Generate share link'}
      </Button>
      {feedback && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            fontSize: 11,
            color: feedback.startsWith('Failed') ? 'var(--c-red)' : 'var(--c-text-mid)',
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            padding: '6px 10px',
            whiteSpace: 'nowrap',
            zIndex: 5,
          }}
        >
          {feedback}
        </div>
      )}
    </div>
  )
}
