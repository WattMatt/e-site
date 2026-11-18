'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createProgrammeAction } from '@/actions/programme.actions'

export function CreateProgrammeForm({ projectId, defaultStart }: { projectId: string; defaultStart: string }) {
  const router = useRouter()
  const [name, setName] = useState('Project programme')
  const [start, setStart] = useState(defaultStart)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await createProgrammeAction({ projectId, kind: 'project', name, projectStart: start })
      if (!res.ok) { setError(res.error); return }
      router.refresh()
    })
  }

  return (
    <div className="page">
      <div className="page-header"><h1 className="page-title">Programme</h1></div>
      <form className="card" onSubmit={submit} style={{ maxWidth: 480, padding: 16, display: 'grid', gap: 12 }}>
        <p>There is no programme on this project yet.</p>
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </label>
        <label className="field">
          <span>Project start</span>
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        {error && <p role="alert" style={{ color: 'var(--c-red)' }}>{error}</p>}
        <div><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create programme'}</button></div>
      </form>
    </div>
  )
}
