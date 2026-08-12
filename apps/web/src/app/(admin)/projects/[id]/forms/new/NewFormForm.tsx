'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSiteFormAction } from '@/actions/site-forms.actions'

export interface BoardOption {
  id: string
  code: string
  name: string | null
  kind: string
}

export interface TemplateOption {
  id: string
  name: string
  version: string
}

// Mirrors the structure.nodes kind CHECK. Boards a site electrician would
// actually isolate come first; the rest stay available but out of the way.
const KIND_LABELS: Record<string, string> = {
  main_board: 'Main boards',
  sub_board: 'Sub boards',
  tenant_db: 'Tenant distribution boards',
  common_area_board: 'Common area boards',
  common_area_lighting: 'Common area lighting',
  mini_sub: 'Mini substations',
  rmu: 'Ring main units',
  generator: 'Generators',
  custom: 'Other',
}
const KIND_ORDER = Object.keys(KIND_LABELS)

export function NewFormForm({
  projectId,
  boards,
  templates,
}: {
  projectId: string
  boards: BoardOption[]
  templates: TemplateOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [templateRowId, setTemplateRowId] = useState(templates[0]?.id ?? '')
  const [nodeId, setNodeId] = useState('')
  const [useFreeText, setUseFreeText] = useState(false)
  const [boardRef, setBoardRef] = useState('')
  const [error, setError] = useState<string | null>(null)

  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    label: KIND_LABELS[kind],
    items: boards.filter((b) => b.kind === kind),
  })).filter((g) => g.items.length > 0)

  const canSubmit =
    Boolean(templateRowId) && (useFreeText ? boardRef.trim().length > 0 : Boolean(nodeId))

  function submit() {
    setError(null)
    startTransition(async () => {
      const res = await createSiteFormAction({
        projectId,
        templateRowId,
        nodeId: useFreeText ? null : nodeId || null,
        boardRef: useFreeText ? boardRef.trim() : null,
      })
      if ('error' in res && res.error) {
        setError(res.error)
        return
      }
      router.push(`/projects/${projectId}/forms/${res.formId}`)
    })
  }

  if (templates.length === 0) {
    return (
      <div className="card empty-state">
        <h2>No form templates available</h2>
        <p>
          No active form template could be found for this organisation. If this is unexpected,
          the Termination and Making Safe system template may not have been seeded yet.
        </p>
        <Link href={`/projects/${projectId}/forms`} className="btn">
          Back to forms
        </Link>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="form-field">
        <label htmlFor="template">Form type</label>
        <select
          id="template"
          value={templateRowId}
          onChange={(e) => setTemplateRowId(e.target.value)}
          disabled={pending}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} (v{t.version})
            </option>
          ))}
        </select>
      </div>

      <div className="form-field">
        <label htmlFor="board">Board</label>
        {!useFreeText ? (
          <>
            <select
              id="board"
              value={nodeId}
              onChange={(e) => setNodeId(e.target.value)}
              disabled={pending || boards.length === 0}
            >
              <option value="">Select a board…</option>
              {grouped.map((g) => (
                <optgroup key={g.kind} label={g.label}>
                  {g.items.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name ? `${b.code} — ${b.name}` : b.code}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="form-hint">
              {boards.length === 0
                ? 'No boards have been captured in this project yet.'
                : 'Pick the board from the project structure so this record is tracked against it.'}{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setUseFreeText(true)
                  setNodeId('')
                }}
                disabled={pending}
              >
                The board is not in the list
              </button>
            </p>
          </>
        ) : (
          <>
            <input
              id="board"
              type="text"
              value={boardRef}
              onChange={(e) => setBoardRef(e.target.value)}
              placeholder="e.g. DB-7, first floor plant room"
              maxLength={200}
              disabled={pending}
            />
            <p className="form-hint">
              Record the board reference as it appears on site. This form will not be linked to
              the project structure, so it will not roll up against a board until one is created.{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setUseFreeText(false)
                  setBoardRef('')
                }}
                disabled={pending}
              >
                Pick from the structure instead
              </button>
            </p>
          </>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <Link href={`/projects/${projectId}/forms`} className="btn">
          Cancel
        </Link>
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={!canSubmit || pending}
        >
          {pending ? 'Creating…' : 'Create form'}
        </button>
      </div>
    </div>
  )
}
