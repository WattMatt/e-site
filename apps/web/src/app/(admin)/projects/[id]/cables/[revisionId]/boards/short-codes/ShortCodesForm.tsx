'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { TableScrollX } from '@/components/ui/TableScrollX'
import { updateBoardShortCodesAction } from '@/actions/board-short-code.actions'

interface BoardWithSuggestion {
  id: string
  code: string
  short_code: string | null
  suggested: string
}

interface Props {
  projectId: string
  revisionId: string
  isDraft: boolean
  boards: BoardWithSuggestion[]
}

export function ShortCodesForm({ projectId, revisionId, isDraft, boards }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Editable values — keyed by board.id, seeded from current short_code or
  // empty (user hits "Apply suggestions" to populate from auto-suggest).
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(boards.map((b) => [b.id, b.short_code ?? '']))
  )

  const onApplySuggestions = () => {
    setValues(Object.fromEntries(boards.map((b) => [b.id, values[b.id] || b.suggested])))
  }

  const onClearAll = () => {
    setValues(Object.fromEntries(boards.map((b) => [b.id, ''])))
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isDraft) return
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const updates = boards.map((b) => ({
        boardId: b.id,
        shortCode: (values[b.id] ?? '').trim() || null,
      }))
      const result = await updateBoardShortCodesAction(projectId, revisionId, updates)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSuccess(`Updated ${result.updated} board${result.updated !== 1 ? 's' : ''}. Tag text will use the new codes for newly-generated tags. Existing tag_text values stay until you click "Regenerate tag text" on the tags page.`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit}>
      <TableScrollX className="data-panel">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          <thead>
            <tr style={{ background: 'var(--c-base)' }}>
              <th style={thStyle}>Board (code)</th>
              <th style={thStyle}>Auto-suggest</th>
              <th style={thStyle}>Short code</th>
            </tr>
          </thead>
          <tbody>
            {boards.map((b) => (
              <tr key={b.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                <td style={tdStyle}>{b.code}</td>
                <td style={{ ...tdStyle, color: 'var(--c-text-dim)' }}>{b.suggested}</td>
                <td style={tdStyle}>
                  <input
                    type="text"
                    value={values[b.id] ?? ''}
                    onChange={(e) => setValues({ ...values, [b.id]: e.target.value })}
                    maxLength={12}
                    placeholder={b.suggested}
                    disabled={!isDraft || pending}
                    className="ob-input"
                    style={{ width: 140, fontFamily: 'var(--font-mono)' }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollX>

      <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={onApplySuggestions}
          disabled={!isDraft || pending}
          className="btn-primary-amber"
          style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}
        >
          ⌁ Apply suggestions to empty rows
        </button>
        <button
          type="button"
          onClick={onClearAll}
          disabled={!isDraft || pending}
          className="btn-primary-amber"
          style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}
        >
          ✕ Clear all
        </button>
        <button
          type="submit"
          disabled={!isDraft || pending}
          className="btn-primary-amber"
        >
          {pending ? 'Saving…' : '✓ Save short codes'}
        </button>
        {error && (
          <div role="alert" style={{ color: '#dc2626', fontSize: 12 }}>{error}</div>
        )}
        {success && (
          <div role="status" style={{ color: '#3DB882', fontSize: 12 }}>{success}</div>
        )}
      </div>
    </form>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 9,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--c-text-dim)',
  fontWeight: 600,
}

const tdStyle: React.CSSProperties = {
  padding: '6px 10px',
  verticalAlign: 'middle',
  color: 'var(--c-text)',
}
