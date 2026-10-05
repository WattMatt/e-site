'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { createTenderAction } from '@/actions/tender.actions'

const PACKAGES = [
  'Electrical contract', 'Lighting', 'Distribution boards', 'Mini sub', 'Generator', 'Lightning protection',
  'Solar PV', 'Metering', 'Security & data', 'Lift', 'Ring main unit', 'UPS',
]

export function NewTenderForm({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [pkg, setPkg] = useState(PACKAGES[0])
  const [title, setTitle] = useState('')
  const [revision, setRevision] = useState('')
  const [closingAt, setClosingAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const r = await createTenderAction(projectId, { package: pkg, title, revision, closingAt: closingAt || null })
      if ('error' in r) return setError(r.error)
      router.push(`/projects/${projectId}/tenders/${r.data.id}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader><span className="data-panel-title">New tender</span></CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <label>Package
            <select value={pkg} onChange={(e) => setPkg(e.target.value)}>
              {PACKAGES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Main electrical installation" /></label>
          <label>Revision<input value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="R9" /></label>
          <label>Closing (optional while draft)<input type="datetime-local" value={closingAt} onChange={(e) => setClosingAt(e.target.value)} /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <Button isLoading={busy} onClick={create} disabled={!title.trim()}>Create draft tender</Button>
          {error && <span role="alert" style={{ color: 'var(--c-red)', fontSize: 13 }}>{error}</span>}
        </div>
      </CardBody>
    </Card>
  )
}
