'use client'
/**
 * "Link to a library licensee" (owner decision; index D2b-5): shown when the
 * Site & Supply name matches nothing in the tariff library. Writes
 * studies.licensee_id through setStudyLicenseeAction (Edit + financials).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { setStudyLicenseeAction } from '@/actions/solar-tariff.actions'

export function LinkLicensee({ projectId, updatedAt, typedName, options }: {
  projectId: string; updatedAt: string; typedName: string; options: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [id, setId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
      <span>&ldquo;{typedName}&rdquo; is not in the tariff library under that name. Link it to:</span>
      <select aria-label="Library supply authority" value={id} onChange={(e) => setId(e.target.value)}>
        <option value="">Choose…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <Button size="sm" disabled={!id} isLoading={busy} onClick={async () => {
        setBusy(true); setError(null)
        const r = await setStudyLicenseeAction({ projectId, licenseeId: id, expectedUpdatedAt: updatedAt })
        setBusy(false)
        if ('error' in r) setError(r.error); else router.refresh()
      }}>Link</Button>
      {error && <span role="alert" style={{ color: 'var(--c-red)' }}>{error}</span>}
    </div>
  )
}
