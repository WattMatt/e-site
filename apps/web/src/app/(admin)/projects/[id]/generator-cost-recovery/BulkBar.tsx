'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import type { GcrZoneRow, ShopCategory, GeneratorParticipation } from '@esite/shared'
import type { GcrAssignmentPatch } from './gcr.schemas'

interface Props {
  selectedCount: number
  zones: GcrZoneRow[]
  onApply: (patch: GcrAssignmentPatch) => Promise<{ ok: true; updated: number } | { error: string }>
  onClear: () => void
}

const CATEGORY_OPTIONS: { value: ShopCategory; label: string }[] = [
  { value: 'standard',   label: 'Standard' },
  { value: 'fast_food',  label: 'Fast food' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'national',   label: 'National' },
  { value: 'other',      label: 'Other' },
]

const PARTICIPATION_OPTIONS: { value: GeneratorParticipation; label: string }[] = [
  { value: 'shared', label: 'Shared' },
  { value: 'own',    label: 'Own generator' },
  { value: 'none',   label: 'Not on generator' },
]

export function BulkBar({ selectedCount, zones, onApply, onClear }: Props) {
  const [zoneId, setZoneId]               = useState('')
  const [participation, setParticipation] = useState('')
  const [category, setCategory]           = useState('')
  const [busy, setBusy]                   = useState(false)
  const [result, setResult]               = useState<
    | { kind: 'ok'; n: number }
    | { kind: 'error'; message: string; patch: GcrAssignmentPatch }
    | null
  >(null)

  function buildPatch(): GcrAssignmentPatch {
    const patch: GcrAssignmentPatch = {}
    if (zoneId !== '') patch.zone_id = zoneId === '__clear__' ? null : zoneId
    if (participation !== '') patch.participation = participation as GeneratorParticipation
    if (category !== '') patch.shop_category = category as ShopCategory
    return patch
  }

  async function apply(patch: GcrAssignmentPatch) {
    setBusy(true)
    setResult(null)
    const res = await onApply(patch)
    setBusy(false)
    if ('ok' in res) {
      setResult({ kind: 'ok', n: res.updated })
    } else {
      setResult({ kind: 'error', message: res.error, patch })
    }
  }

  if (selectedCount === 0) return null

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '10px 14px',
        background: 'var(--c-panel)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
      }}
    >
      <strong style={{ fontSize: 13 }}>{selectedCount} selected</strong>

      <select
        aria-label="Bulk assign zone"
        value={zoneId}
        onChange={(e) => setZoneId(e.target.value)}
        disabled={busy}
      >
        <option value="">Zone…</option>
        <option value="__clear__">— no zone —</option>
        {zones.map((z) => (
          <option key={z.id} value={z.id}>
            {z.zone_name}
          </option>
        ))}
      </select>

      <select
        aria-label="Bulk set participation"
        value={participation}
        onChange={(e) => setParticipation(e.target.value)}
        disabled={busy}
      >
        <option value="">Participation…</option>
        {PARTICIPATION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Bulk set category"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        disabled={busy}
      >
        <option value="">Category…</option>
        {CATEGORY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <Button
        size="sm"
        variant="primary"
        disabled={busy || Object.keys(buildPatch()).length === 0}
        onClick={() => void apply(buildPatch())}
      >
        Apply
      </Button>

      <Button size="sm" variant="secondary" onClick={onClear} disabled={busy}>
        Clear
      </Button>

      {result?.kind === 'ok' && (
        <span style={{ fontSize: 12, color: 'var(--c-green, #16a34a)' }}>
          Applied to {result.n} shops
        </span>
      )}

      {result?.kind === 'error' && (
        <span role="alert" style={{ fontSize: 12, color: 'var(--c-red)', display: 'inline-flex', gap: 8 }}>
          {result.message}
          <button
            type="button"
            onClick={() => void apply(result.patch)}
            style={{
              textDecoration: 'underline',
              background: 'none',
              border: 'none',
              color: 'var(--c-red)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Retry
          </button>
        </span>
      )}
    </div>
  )
}
