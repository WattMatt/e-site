'use client'

/**
 * Create a programme: "Our programme" (the project programme, one per project) or a
 * "Contractor programme" (one per contractor name, filled by importing that contractor's MS Project
 * file). On success the screen goes to the new programme. Shown only to editors: the page gives it
 * to ORG_WRITE_ROLES, and the toolbar's "New programme…" only with `canEdit`.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createProgrammeAction } from '@/actions/programme.actions'

type Kind = 'project' | 'contractor'
const PROJECT_DEFAULT = 'Project programme'

export function CreateProgrammeForm({ projectId, defaultStart, hasProjectProgramme = false, embedded = false, onCancel }: {
  projectId: string
  defaultStart: string
  /** The project already has its own programme: only a contractor programme can be made. */
  hasProjectProgramme?: boolean
  /** Rendered inside a dialog rather than as the page. */
  embedded?: boolean
  onCancel?: () => void
}) {
  const router = useRouter()
  const [kind, setKind] = useState<Kind>(hasProjectProgramme ? 'contractor' : 'project')
  const [name, setName] = useState('')
  const [contractor, setContractor] = useState('')
  const [start, setStart] = useState(defaultStart)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const label = contractor.trim()
  // The name follows the choice until it is typed.
  const effectiveName = name.trim() !== '' ? name.trim() : kind === 'contractor' ? (label ? `${label} programme` : '') : PROJECT_DEFAULT

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (kind === 'contractor' && label === '') { setError('Name the contractor.'); return }
    if (effectiveName === '') { setError('Give the programme a name.'); return }
    startTransition(async () => {
      const res = await createProgrammeAction(kind === 'contractor'
        ? { projectId, kind, name: effectiveName, projectStart: start, contractorLabel: label }
        : { projectId, kind, name: effectiveName, projectStart: start })
      if (!res.ok) { setError(res.error); return }
      router.push(`/projects/${projectId}/programme?programme=${res.programmeId}`)
    })
  }

  const form = (
    <form className="card" onSubmit={submit} noValidate style={{ maxWidth: 480, padding: 16, display: 'grid', gap: 12 }}>
      {!embedded && <p>There is no programme on this project yet.</p>}
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}>
        <legend style={{ fontSize: 13, marginBottom: 4 }}>Whose programme</legend>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="radio" name="programme-kind" checked={kind === 'project'} disabled={hasProjectProgramme}
            onChange={() => setKind('project')} />
          Our programme
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="radio" name="programme-kind" checked={kind === 'contractor'} onChange={() => setKind('contractor')} />
          Contractor programme
        </label>
        {hasProjectProgramme && <span style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>This project already has its own programme.</span>}
      </fieldset>
      {kind === 'contractor' && (
        <label className="field">
          <span>Contractor name</span>
          <input className="input" value={contractor} onChange={(e) => setContractor(e.target.value)} maxLength={120} />
        </label>
      )}
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} placeholder={effectiveName || undefined} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </label>
      <label className="field">
        <span>Project start</span>
        <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
      </label>
      {kind === 'contractor' && <p style={{ color: 'var(--c-text-dim)', fontSize: 12, margin: 0 }}>Next, import the contractor&apos;s programme from MS Project.</p>}
      {error && <p role="alert" style={{ color: 'var(--c-red)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create programme'}</button>
        {onCancel && <button className="btn" type="button" onClick={onCancel} disabled={pending}>Cancel</button>}
      </div>
    </form>
  )
  if (embedded) return form
  return (
    <div className="page">
      <div className="page-header"><h1 className="page-title">Project Programme</h1></div>
      {form}
    </div>
  )
}
