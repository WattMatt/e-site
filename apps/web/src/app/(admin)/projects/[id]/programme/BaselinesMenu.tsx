'use client'

/**
 * The baselines menu: the programme's saved baselines with the active one marked.
 *
 * - Everyone who can see the programme sees the list.
 * - With `canEdit`: "Save baseline…" (a name, and "Set as active", ticked by default),
 *   "Set active" on the others, and "Delete" with a two-step inline confirm (never
 *   `window.confirm`: Safari can suppress it).
 * - Each call goes to its server action; a success calls `onChanged` (the screen reloads its
 *   view, so the bars and the list come from the database), a refusal is shown in place.
 * - A baseline is a copy of what the DATABASE holds, so saving one is refused while the screen
 *   has changes the server has not confirmed.
 */
import { useState, type CSSProperties } from 'react'
import { deleteBaselineAction, saveBaselineAction, setActiveBaselineAction } from '@/actions/programme.actions'
import type { BaselineSummary } from '@/lib/programme/view-types'

const button: CSSProperties = {
  padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c-border)', background: 'var(--c-panel)',
  color: 'var(--c-text)', fontSize: 12, cursor: 'pointer',
}
const FAILED = 'The baseline could not be changed. Try again.'
export const BASELINE_WAIT = 'Wait for your changes to save before saving a baseline.'

export interface BaselinesMenuProps {
  programmeId: string
  baselines: BaselineSummary[]
  canEdit: boolean
  /** The screen has changes that are not saved yet. */
  unsaved: boolean
  onChanged: () => void
}

export function BaselinesMenu({ programmeId, baselines, canEdit, unsaved, onChanged }: BaselinesMenuProps) {
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [setActive, setSetActive] = useState(true)
  const [armed, setArmed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (call: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: () => void) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await call()
      if (r.ok) { done?.(); onChanged() } else setError(r.error)
    } catch {
      setError(FAILED)
    } finally {
      setBusy(false)
    }
  }
  const save = () => {
    const n = name.trim()
    if (unsaved) { setError(BASELINE_WAIT); return }
    if (n === '') { setError('Give the baseline a name.'); return }
    void run(
      () => saveBaselineAction({ programmeId, name: n, setActive }),
      () => { setNaming(false); setName('') },
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" style={button} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        Baselines ({baselines.length})
      </button>
      {open && (
        <div role="group" aria-label="Baselines" data-testid="programme-baselines" style={{
          position: 'absolute', left: 0, top: '100%', marginTop: 4, zIndex: 5, minWidth: 280, padding: 8, borderRadius: 8,
          border: '1px solid var(--c-border)', background: 'var(--c-elevated)', display: 'grid', gap: 6, fontSize: 12,
        }}>
          {baselines.length === 0 && <span style={{ color: 'var(--c-text-dim)' }}>No baselines saved yet.</span>}
          {baselines.map((b) => (
            <div key={b.id} data-baseline-id={b.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {b.name}
                <span style={{ color: 'var(--c-text-dim)' }}> · {b.created_at.slice(0, 10)}</span>
              </span>
              {b.is_active && <span data-testid="baseline-active" style={{ fontWeight: 600, color: 'var(--c-amber)' }}>Active</span>}
              {canEdit && armed !== b.id && (
                <>
                  {!b.is_active && (
                    <button type="button" style={button} disabled={busy} aria-label={`Set ${b.name} active`}
                      onClick={() => void run(() => setActiveBaselineAction({ baselineId: b.id }))}>Set active</button>
                  )}
                  <button type="button" style={button} disabled={busy} aria-label={`Delete ${b.name}`} onClick={() => setArmed(b.id)}>Delete</button>
                </>
              )}
              {canEdit && armed === b.id && (
                <span role="alert" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Delete {b.name}?
                  <button type="button" style={{ ...button, borderColor: 'var(--c-red)', color: 'var(--c-red)' }} disabled={busy}
                    onClick={() => void run(() => deleteBaselineAction({ baselineId: b.id }), () => setArmed(null))}>Confirm delete</button>
                  <button type="button" style={button} onClick={() => setArmed(null)}>Cancel</button>
                </span>
              )}
            </div>
          ))}
          {canEdit && !naming && (
            <>
              <button type="button" style={button} disabled={unsaved || busy} title={unsaved ? BASELINE_WAIT : undefined}
                onClick={() => { setNaming(true); setError(null) }}>Save baseline…</button>
            </>
          )}
          {canEdit && unsaved && <span style={{ color: 'var(--c-text-dim)' }}>{BASELINE_WAIT}</span>}
          {canEdit && naming && (
            <form onSubmit={(e) => { e.preventDefault(); save() }} style={{ display: 'grid', gap: 6 }}>
              <input aria-label="Baseline name" value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)}
                style={{ padding: '4px 6px', borderRadius: 4, border: '1px solid var(--c-border)', background: 'var(--c-input-bg)', color: 'var(--c-text)', fontSize: 12 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={setActive} onChange={(e) => setSetActive(e.target.checked)} />
                Set as active
              </label>
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="submit" style={button} disabled={busy || unsaved} title={unsaved ? BASELINE_WAIT : undefined}>Save</button>
                <button type="button" style={button} onClick={() => { setNaming(false); setError(null) }}>Cancel</button>
              </span>
            </form>
          )}
          {error && <span role="alert" data-testid="baselines-error" style={{ color: 'var(--c-red)' }}>{error}</span>}
        </div>
      )}
    </div>
  )
}
