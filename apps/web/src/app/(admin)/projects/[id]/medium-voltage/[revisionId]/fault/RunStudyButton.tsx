'use client'

/**
 * Triggers the heavy Z-bus + earth-fault solve for this revision. POSTs to the
 * route handler (apps/web/src/app/api/medium-voltage/study/route.ts) — the solve
 * is kept out of a server action to dodge action timeouts — then refreshes the
 * page so the freshly-cached fault_results render. Mirrors the ExportMenu /
 * AddEntityPanel client-action pattern (useTransition-less router.refresh here
 * because the fetch itself is the async boundary).
 *
 * Disabled on a non-DRAFT revision (the route refuses to write a frozen
 * snapshot anyway — this just avoids a guaranteed-422 round-trip).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  revisionId: string
  disabled?: boolean
  /** Re-label for the empty state ("Run study") vs a re-run ("Re-run study"). */
  hasResults?: boolean
}

export function RunStudyButton({ revisionId, disabled, hasResults }: Props) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setError(null)
    setRunning(true)
    try {
      const res = await fetch('/api/medium-voltage/study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revisionId }),
      })
      const body = (await res.json().catch(() => null)) as
        | { data?: { nodeCount: number }; error?: string }
        | null
      if (!res.ok || !body || body.error) {
        setError(body?.error ?? `Study failed (HTTP ${res.status})`)
        return
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Study failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <button
        type="button"
        className="btn-primary-amber"
        onClick={run}
        disabled={disabled || running}
        title={disabled ? 'Revision is read-only — start a new revision to recompute' : undefined}
        style={{ opacity: disabled || running ? 0.6 : 1 }}
      >
        {running ? 'Running…' : hasResults ? '↻ Re-run study' : '⚡ Run study'}
      </button>
      {error && (
        <span role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>
          ✕ {error}
        </span>
      )}
    </div>
  )
}
