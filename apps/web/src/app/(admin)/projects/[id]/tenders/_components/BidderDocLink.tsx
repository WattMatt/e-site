'use client'

import { useState } from 'react'
import { getBidderDocumentUrlAction } from '@/actions/tender-documents.actions'

/** Opens one bidder document. The seal is the database's: the action can only sign a row the caller's session can read. */
export function BidderDocLink({ tenderId, documentId, fileName }: { tenderId: string; documentId: string; fileName: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            const r = await getBidderDocumentUrlAction(tenderId, documentId)
            if ('error' in r) return setError(r.error)
            window.location.href = r.data.url
          } finally {
            setBusy(false)
          }
        }}
      >
        {fileName}
      </button>
      {error && <span role="alert" style={{ fontSize: 12, color: 'var(--c-red)' }}> {error}</span>}
    </>
  )
}
