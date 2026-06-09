'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  upsertZoneAction,
  deleteZoneAction,
  upsertGeneratorAction,
  deleteGeneratorAction,
} from './gcr.actions'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ZoneRow {
  id: string
  zone_name: string
  zone_number: number
  display_order: number
}

interface GeneratorRow {
  id: string
  zone_id: string
  generator_number: number
  generator_size: string | null
  generator_cost: number
}

interface Props {
  projectId: string
  zones: ZoneRow[]
  generators: GeneratorRow[]
}

// ─── ZonesPanel ───────────────────────────────────────────────────────────────

export function ZonesPanel({ projectId, zones, generators }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // ── Add zone state ──────────────────────────────────────────────────────────
  const [addingZone, setAddingZone] = useState(false)
  const [newZoneName, setNewZoneName] = useState('')
  const [zoneError, setZoneError] = useState<string | null>(null)

  // ── Per-zone: rename state ──────────────────────────────────────────────────
  const [renamingZoneId, setRenamingZoneId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // ── Per-zone: confirm-delete state ──────────────────────────────────────────
  const [confirmDeleteZoneId, setConfirmDeleteZoneId] = useState<string | null>(null)

  // ── Per-zone: add generator form ────────────────────────────────────────────
  const [addingGenForZoneId, setAddingGenForZoneId] = useState<string | null>(null)
  const [newGenSize, setNewGenSize] = useState('')
  const [newGenCost, setNewGenCost] = useState('')
  const [genError, setGenError] = useState<string | null>(null)

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function nextZoneNumber(): number {
    if (zones.length === 0) return 1
    return Math.max(...zones.map((z) => z.zone_number)) + 1
  }

  function generatorsForZone(zoneId: string): GeneratorRow[] {
    return generators
      .filter((g) => g.zone_id === zoneId)
      .sort((a, b) => a.generator_number - b.generator_number)
  }

  function nextGeneratorNumber(zoneId: string): number {
    const gens = generatorsForZone(zoneId)
    if (gens.length === 0) return 1
    return Math.max(...gens.map((g) => g.generator_number)) + 1
  }

  function runAction(fn: () => Promise<unknown>) {
    startTransition(async () => {
      await fn()
      router.refresh()
    })
  }

  // ─── Add zone ────────────────────────────────────────────────────────────────

  async function handleAddZone() {
    const name = newZoneName.trim()
    if (!name) { setZoneError('Zone name is required.'); return }
    setZoneError(null)
    runAction(async () => {
      const res = await upsertZoneAction(projectId, {
        zone_name: name,
        zone_number: nextZoneNumber(),
      })
      if ('error' in res) { setZoneError(res.error); return }
      setNewZoneName('')
      setAddingZone(false)
    })
  }

  // ─── Rename zone ──────────────────────────────────────────────────────────────

  async function handleRenameZone(zone: ZoneRow) {
    const name = renameValue.trim()
    if (!name) return
    runAction(async () => {
      await upsertZoneAction(projectId, {
        id: zone.id,
        zone_name: name,
        zone_number: zone.zone_number,
      })
      setRenamingZoneId(null)
    })
  }

  // ─── Delete zone ──────────────────────────────────────────────────────────────

  async function handleDeleteZone(zoneId: string) {
    runAction(async () => {
      await deleteZoneAction(projectId, zoneId)
      setConfirmDeleteZoneId(null)
    })
  }

  // ─── Add generator ────────────────────────────────────────────────────────────

  async function handleAddGenerator(zoneId: string) {
    const cost = parseFloat(newGenCost)
    if (isNaN(cost) || cost < 0) { setGenError('Enter a valid cost.'); return }
    setGenError(null)
    runAction(async () => {
      const res = await upsertGeneratorAction(projectId, {
        zone_id: zoneId,
        generator_number: nextGeneratorNumber(zoneId),
        generator_size: newGenSize.trim() || null,
        generator_cost: cost,
      })
      if ('error' in res) { setGenError(res.error); return }
      setNewGenSize('')
      setNewGenCost('')
      setAddingGenForZoneId(null)
    })
  }

  // ─── Delete generator ──────────────────────────────────────────────────────────

  async function handleDeleteGenerator(generatorId: string) {
    runAction(() => deleteGeneratorAction(projectId, generatorId))
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  const busy = isPending

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {zones.length === 0 && !addingZone && (
        <div
          style={{
            padding: '32px 18px',
            textAlign: 'center',
            color: 'var(--c-text-dim)',
            fontSize: 13,
            fontStyle: 'italic',
          }}
        >
          No zones configured yet. Add a zone to get started.
        </div>
      )}

      {zones.map((zone) => {
        const gens = generatorsForZone(zone.id)
        const isRenaming = renamingZoneId === zone.id
        const isConfirmDelete = confirmDeleteZoneId === zone.id
        const isAddingGen = addingGenForZoneId === zone.id

        return (
          <Card key={zone.id}>
            <CardHeader>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {isRenaming ? (
                  <>
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameZone(zone)
                        if (e.key === 'Escape') setRenamingZoneId(null)
                      }}
                      autoFocus
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        padding: '4px 8px',
                        borderRadius: 5,
                        border: '1px solid var(--c-border)',
                        background: 'var(--c-input)',
                        color: 'var(--c-text)',
                        fontFamily: 'var(--font-sans)',
                        minWidth: 160,
                      }}
                    />
                    <Button size="sm" variant="primary" onClick={() => handleRenameZone(zone)} disabled={busy}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenamingZoneId(null)} disabled={busy}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)', flex: 1 }}>
                      Zone {zone.zone_number} — {zone.zone_name}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setRenamingZoneId(zone.id); setRenameValue(zone.zone_name) }}
                      disabled={busy}
                    >
                      Rename
                    </Button>
                    {isConfirmDelete ? (
                      <>
                        <span style={{ fontSize: 12, color: 'var(--c-red)', fontFamily: 'var(--font-sans)' }}>
                          Delete zone and all its generators?
                        </span>
                        <Button size="sm" variant="danger" onClick={() => handleDeleteZone(zone.id)} disabled={busy}>
                          Confirm delete
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteZoneId(null)} disabled={busy}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDeleteZoneId(zone.id)}
                        disabled={busy}
                        style={{ color: 'var(--c-red)' }}
                      >
                        Delete
                      </Button>
                    )}
                  </>
                )}
              </div>
            </CardHeader>

            <CardBody>
              {/* Generator rows */}
              {gens.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={TH}>#</th>
                        <th style={TH}>Size</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Cost (R)</th>
                        <th style={{ ...TH, width: 40 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {gens.map((gen) => (
                        <tr key={gen.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                          <td style={TD}>{gen.generator_number}</td>
                          <td style={TD}>{gen.generator_size ?? '—'}</td>
                          <td style={{ ...TD, textAlign: 'right' }}>
                            {gen.generator_cost.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
                          </td>
                          <td style={TD}>
                            <button
                              type="button"
                              onClick={() => handleDeleteGenerator(gen.id)}
                              disabled={busy}
                              aria-label="Delete generator"
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: busy ? 'not-allowed' : 'pointer',
                                color: 'var(--c-text-dim)',
                                fontSize: 14,
                                padding: '2px 6px',
                                borderRadius: 4,
                              }}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {gens.length === 0 && !isAddingGen && (
                <p style={{ fontSize: 12, color: 'var(--c-text-dim)', fontStyle: 'italic', marginBottom: 10 }}>
                  No generators in this zone.
                </p>
              )}

              {/* Add generator inline form */}
              {isAddingGen ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      placeholder="Size (e.g. 500 kVA)"
                      value={newGenSize}
                      onChange={(e) => { setNewGenSize(e.target.value); setGenError(null) }}
                      style={INLINE_INPUT}
                    />
                    <input
                      type="number"
                      placeholder="Cost (R)"
                      value={newGenCost}
                      min={0}
                      step="0.01"
                      onChange={(e) => { setNewGenCost(e.target.value); setGenError(null) }}
                      style={{ ...INLINE_INPUT, width: 140 }}
                    />
                  </div>
                  {genError && (
                    <span style={{ fontSize: 12, color: 'var(--c-red)' }}>{genError}</span>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button size="sm" variant="primary" onClick={() => handleAddGenerator(zone.id)} disabled={busy}>
                      Add generator
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setAddingGenForZoneId(null); setGenError(null); setNewGenSize(''); setNewGenCost('') }}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { setAddingGenForZoneId(zone.id); setGenError(null) }}
                  disabled={busy}
                >
                  + Add generator
                </Button>
              )}
            </CardBody>
          </Card>
        )
      })}

      {/* Add zone form */}
      {addingZone ? (
        <Card>
          <CardBody>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)' }}>
                New zone name
              </label>
              <input
                type="text"
                placeholder="e.g. North Wing"
                value={newZoneName}
                onChange={(e) => { setNewZoneName(e.target.value); setZoneError(null) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddZone()
                  if (e.key === 'Escape') { setAddingZone(false); setNewZoneName('') }
                }}
                autoFocus
                style={INLINE_INPUT}
              />
              {zoneError && (
                <span style={{ fontSize: 12, color: 'var(--c-red)' }}>{zoneError}</span>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" variant="primary" onClick={handleAddZone} disabled={busy}>
                  Add zone
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setAddingZone(false); setNewZoneName(''); setZoneError(null) }}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setAddingZone(true)}
            disabled={busy}
          >
            + Add zone
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Style constants ──────────────────────────────────────────────────────────

const TH: React.CSSProperties = {
  padding: '6px 8px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--c-text-dim)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
}

const TD: React.CSSProperties = {
  padding: '7px 8px',
  fontSize: 13,
  color: 'var(--c-text)',
  whiteSpace: 'nowrap',
}

const INLINE_INPUT: React.CSSProperties = {
  fontSize: 13,
  padding: '6px 10px',
  borderRadius: 5,
  border: '1px solid var(--c-border)',
  background: 'var(--c-input)',
  color: 'var(--c-text)',
  fontFamily: 'var(--font-sans)',
  flex: 1,
  minWidth: 160,
}
