'use client'

/**
 * FaultLevelEditor — compact header control for `revisions.fault_level_ka`,
 * the source prospective fault current the schedule's short-circuit check
 * (shortCircuitCheck vs each strand's adiabatic 1 s withstand) consumes.
 *
 * Reuses `overrideFaultLevel` from mv-protection.actions — the same
 * DRAFT-gated + ORG_WRITE_ROLES-gated action the MV study workspace uses,
 * so provenance lands in change_log identically. `canEdit` only hides the
 * control on ISSUED revisions; the server action is the real gate.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { overrideFaultLevel } from '@/actions/mv-protection.actions'

interface Props {
  revisionId: string
  faultLevelKa: number | null
  canEdit: boolean
}

export function FaultLevelEditor({ revisionId, faultLevelKa, canEdit }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(faultLevelKa == null ? '' : String(faultLevelKa))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chipStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
    padding: '4px 8px', borderRadius: 4,
    color: faultLevelKa == null ? 'var(--c-text-dim)' : 'var(--c-text-mid)',
    background: 'var(--c-base)', border: '1px solid var(--c-border)',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  }

  async function save() {
    const trimmed = value.trim()
    const parsed = trimmed === '' ? null : Number(trimmed)
    // 0 kA is not a fault level — the short-circuit check treats ≤ 0 as
    // "not set", so storing it would silently disable the check while the
    // chip claims a value. Blank clears; anything else must be positive.
    if (parsed != null && (!Number.isFinite(parsed) || parsed <= 0)) {
      setError('Must be a positive number (leave blank to clear)')
      return
    }
    setSaving(true)
    setError(null)
    const res = await overrideFaultLevel({
      revisionId,
      faultLevelKa: parsed,
      reason: 'Set from cable schedule header',
    })
    setSaving(false)
    if ('error' in res) {
      setError(res.error)
      return
    }
    setEditing(false)
    router.refresh()
  }

  if (!editing) {
    return (
      <span
        style={chipStyle}
        title={
          faultLevelKa == null
            ? 'Prospective fault level at the source (kA). Not set — the short-circuit column shows "—" until it is.'
            : 'Prospective fault level at the source — each strand\'s 1 s adiabatic withstand is checked against this.'
        }
      >
        ⚡ fault level: {faultLevelKa == null ? 'not set' : `${faultLevelKa} kA`}
        {canEdit && (
          <button
            type="button"
            onClick={() => { setValue(faultLevelKa == null ? '' : String(faultLevelKa)); setEditing(true) }}
            aria-label="Edit fault level"
            title="Edit the revision's fault level (kA)"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 11, padding: 0 }}
          >
            ✏
          </button>
        )}
      </span>
    )
  }

  return (
    <span style={{ ...chipStyle, gap: 4 }}>
      ⚡
      <input
        type="number"
        step="0.1"
        min={0.1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
          if (e.key === 'Escape') setEditing(false)
        }}
        disabled={saving}
        aria-label="Fault level (kA)"
        placeholder="kA"
        autoFocus
        style={{
          width: 64, fontFamily: 'var(--font-mono)', fontSize: 11,
          background: 'var(--c-panel)', border: '1px solid var(--c-border)',
          borderRadius: 3, color: 'var(--c-text)', padding: '1px 4px',
        }}
      />
      kA
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="btn-primary-amber"
        style={{ padding: '1px 8px', fontSize: 10 }}
      >
        {saving ? '…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => { setEditing(false); setError(null) }}
        disabled={saving}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 10 }}
      >
        Cancel
      </button>
      {error && <span role="alert" style={{ color: 'var(--c-red)' }}>{error}</span>}
    </span>
  )
}
