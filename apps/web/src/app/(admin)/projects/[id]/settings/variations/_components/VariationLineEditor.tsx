'use client'

/**
 * VariationLineEditor — the inline "add a line" form for a DRAFT variation
 * order. Two kinds (toggle):
 *
 *   adjust — a searchable picker over the contract BOQ items (code +
 *            description filter); the selected item shows its contract qty +
 *            rate; a ± qty-delta input drives a live value-change preview via
 *            the shared computeLineChange (the server recomputes — the preview
 *            is display-only).
 *   add    — a section picker + description/unit/qty + rate-model toggle +
 *            rate inputs, with the same live preview.
 *
 * Submit → upsertVariationLineAction; server errors (incl. the >= 0
 * revised-quantity floor) surface inline.
 */

import { useMemo, useState } from 'react'
import { computeLineChange, type BoqItem, type BoqSection } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { upsertVariationLineAction } from '@/actions/variation.actions'
import { fmtMoney, fmtQty } from '../../rates/_components/format'
import { NetChange } from './VariationsList'

interface Props {
  projectId: string
  voId: string
  sections: BoqSection[]
  items: BoqItem[]
  /** Called after a successful save so the parent can re-fetch the VO. */
  onSaved: () => void
  onCancel: () => void
}

const FIELD_LABEL: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.06em',
  marginBottom: 6,
  textTransform: 'uppercase',
}
const FIELD_INPUT: React.CSSProperties = {
  width: '100%',
  background: 'var(--c-panel-deep)',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  padding: '9px 12px',
  color: 'var(--c-text)',
  fontSize: 13,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

/** The item's contract rate for display: single → rate; supply_install → the sum. */
function fmtItemRate(item: BoqItem): string {
  if (item.rateModel === 'amount_only') return '—'
  if (item.rateModel === 'single') return fmtMoney(item.rate)
  return fmtMoney((item.supplyRate ?? 0) + (item.installRate ?? 0))
}

function parseNum(s: string): number | null {
  if (s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function VariationLineEditor({ projectId, voId, sections, items, onSaved, onCancel }: Props) {
  const [kind, setKind] = useState<'adjust' | 'add'>('adjust')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // adjust state
  const [search, setSearch] = useState('')
  const [boqItemId, setBoqItemId] = useState<string | null>(null)
  const [qtyDeltaStr, setQtyDeltaStr] = useState('')

  // add state
  const [sectionId, setSectionId] = useState('')
  const [description, setDescription] = useState('')
  const [unit, setUnit] = useState('')
  const [quantityStr, setQuantityStr] = useState('')
  const [rateModel, setRateModel] = useState<'supply_install' | 'single'>('supply_install')
  const [supplyRateStr, setSupplyRateStr] = useState('')
  const [installRateStr, setInstallRateStr] = useState('')
  const [rateStr, setRateStr] = useState('')

  const selectedItem = useMemo(
    () => (boqItemId ? items.find((it) => it.id === boqItemId) ?? null : null),
    [items, boqItemId],
  )

  // Contract items only — materialized variation items are not re-adjustable here.
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return items
      .filter((it) => it.origin === 'contract')
      .filter((it) => `${it.code ?? ''} ${it.description}`.toLowerCase().includes(q))
      .slice(0, 25)
  }, [items, search])

  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.sortOrder - b.sortOrder),
    [sections],
  )

  // ── Live value-change preview (display-only; the server recomputes) ─────────
  const qtyDelta = parseNum(qtyDeltaStr)
  const quantity = parseNum(quantityStr)
  const supplyRate = parseNum(supplyRateStr)
  const installRate = parseNum(installRateStr)
  const rate = parseNum(rateStr)

  const preview = useMemo(() => {
    try {
      if (kind === 'adjust') {
        if (!selectedItem || qtyDelta == null) return null
        return computeLineChange(
          { kind: 'adjust', qtyDelta, quantity: null, rateModel: null, supplyRate: null, installRate: null, rate: null },
          selectedItem,
        )
      }
      if (quantity == null) return null
      if (rateModel === 'single' ? rate == null : supplyRate == null && installRate == null) return null
      return computeLineChange({
        kind: 'add',
        qtyDelta: null,
        quantity,
        rateModel,
        supplyRate,
        installRate,
        rate,
      })
    } catch {
      return null
    }
  }, [kind, selectedItem, qtyDelta, quantity, rateModel, supplyRate, installRate, rate])

  async function handleSave() {
    setError(null)
    if (kind === 'adjust') {
      if (!selectedItem) {
        setError('Pick the contract item to adjust')
        return
      }
      if (qtyDelta == null || qtyDelta === 0) {
        setError('Enter a non-zero quantity delta')
        return
      }
    } else {
      if (!sectionId) {
        setError('Pick the section the new item belongs to')
        return
      }
      if (!description.trim()) {
        setError('A description is required')
        return
      }
      if (quantity == null || quantity < 0) {
        setError('Enter a quantity (0 or more)')
        return
      }
      if (rateModel === 'single' ? rate == null : supplyRate == null && installRate == null) {
        setError('Enter a rate')
        return
      }
    }

    setSubmitting(true)
    const res = await upsertVariationLineAction(
      projectId,
      voId,
      kind === 'adjust'
        ? { kind: 'adjust', boqItemId: selectedItem!.id, qtyDelta: qtyDelta! }
        : {
            kind: 'add',
            sectionId,
            description: description.trim(),
            unit: unit.trim() || null,
            quantity: quantity!,
            rateModel,
            supplyRate: rateModel === 'single' ? null : supplyRate,
            installRate: rateModel === 'single' ? null : installRate,
            rate: rateModel === 'single' ? rate : null,
          },
    )
    setSubmitting(false)
    if ('error' in res) {
      setError(res.error)
      return
    }
    onSaved()
  }

  return (
    <div
      style={{
        background: 'var(--c-panel)',
        border: '1px solid var(--c-border-mid)',
        borderRadius: 8,
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* Kind toggle */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          variant={kind === 'adjust' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => { setKind('adjust'); setError(null) }}
        >
          Adjust contract item
        </Button>
        <Button
          variant={kind === 'add' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => { setKind('add'); setError(null) }}
        >
          Add new item
        </Button>
      </div>

      {kind === 'adjust' ? (
        <>
          {/* Item picker */}
          {selectedItem ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                background: 'var(--c-panel-deep)',
                border: '1px solid var(--c-border)',
                borderRadius: 6,
                padding: '10px 14px',
              }}
            >
              {selectedItem.code && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--c-text-dim)' }}>
                  {selectedItem.code}
                </span>
              )}
              <span style={{ fontSize: 13, color: 'var(--c-text)', flex: 1, minWidth: 160 }}>
                {selectedItem.description}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', whiteSpace: 'nowrap' }}>
                Contract qty {fmtQty(selectedItem.quantity)}
                {selectedItem.unit ? ` ${selectedItem.unit}` : ''} · rate {fmtItemRate(selectedItem)}
              </span>
              <Button variant="ghost" size="sm" onClick={() => { setBoqItemId(null); setQtyDeltaStr('') }}>
                Change item
              </Button>
            </div>
          ) : (
            <div>
              <label style={FIELD_LABEL} htmlFor="vl_search">Find contract item</label>
              <input
                id="vl_search"
                type="text"
                style={FIELD_INPUT}
                placeholder="Search by code or description…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {matches.length > 0 && (
                <div
                  role="listbox"
                  aria-label="Matching contract items"
                  style={{
                    marginTop: 6,
                    border: '1px solid var(--c-border)',
                    borderRadius: 6,
                    maxHeight: 240,
                    overflowY: 'auto',
                  }}
                >
                  {matches.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => { setBoqItemId(it.id); setSearch('') }}
                      style={{
                        display: 'flex',
                        width: '100%',
                        alignItems: 'center',
                        gap: 10,
                        background: 'var(--c-panel-deep)',
                        border: 'none',
                        borderBottom: '1px solid var(--c-border)',
                        padding: '8px 12px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', whiteSpace: 'nowrap' }}>
                        {it.code ?? '—'}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--c-text)', flex: 1 }}>{it.description}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', whiteSpace: 'nowrap' }}>
                        {fmtQty(it.quantity)}{it.unit ? ` ${it.unit}` : ''} @ {fmtItemRate(it)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {search.trim() !== '' && matches.length === 0 && (
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--c-text-dim)' }}>No matching contract items.</p>
              )}
            </div>
          )}

          {/* ± qty delta */}
          <div style={{ maxWidth: 220 }}>
            <label style={FIELD_LABEL} htmlFor="vl_delta">Qty delta (±)</label>
            <input
              id="vl_delta"
              type="number"
              step="any"
              style={FIELD_INPUT}
              placeholder="e.g. -3 or 12"
              value={qtyDeltaStr}
              onChange={(e) => setQtyDeltaStr(e.target.value)}
            />
          </div>
        </>
      ) : (
        <>
          {/* Section + description */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px' }}>
              <label style={FIELD_LABEL} htmlFor="vl_section">Section</label>
              <select
                id="vl_section"
                style={FIELD_INPUT}
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
              >
                <option value="">Select a section…</option>
                {sortedSections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code ? `${s.code} · ` : ''}{s.title}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: '2 1 280px' }}>
              <label style={FIELD_LABEL} htmlFor="vl_desc">Description</label>
              <input
                id="vl_desc"
                type="text"
                style={FIELD_INPUT}
                placeholder="e.g. Extra 4-way DB complete"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          {/* Unit + qty + rate model */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '0 1 110px' }}>
              <label style={FIELD_LABEL} htmlFor="vl_unit">Unit</label>
              <input
                id="vl_unit"
                type="text"
                style={FIELD_INPUT}
                placeholder="No / m"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
            <div style={{ flex: '0 1 140px' }}>
              <label style={FIELD_LABEL} htmlFor="vl_qty">Qty</label>
              <input
                id="vl_qty"
                type="number"
                min="0"
                step="any"
                style={FIELD_INPUT}
                value={quantityStr}
                onChange={(e) => setQuantityStr(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                variant={rateModel === 'supply_install' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setRateModel('supply_install')}
              >
                Supply + Install
              </Button>
              <Button
                variant={rateModel === 'single' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setRateModel('single')}
              >
                Single rate
              </Button>
            </div>
          </div>

          {/* Rates */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {rateModel === 'single' ? (
              <div style={{ flex: '0 1 160px' }}>
                <label style={FIELD_LABEL} htmlFor="vl_rate">Rate</label>
                <input
                  id="vl_rate"
                  type="number"
                  min="0"
                  step="any"
                  style={FIELD_INPUT}
                  value={rateStr}
                  onChange={(e) => setRateStr(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div style={{ flex: '0 1 160px' }}>
                  <label style={FIELD_LABEL} htmlFor="vl_supply">Supply rate</label>
                  <input
                    id="vl_supply"
                    type="number"
                    min="0"
                    step="any"
                    style={FIELD_INPUT}
                    value={supplyRateStr}
                    onChange={(e) => setSupplyRateStr(e.target.value)}
                  />
                </div>
                <div style={{ flex: '0 1 160px' }}>
                  <label style={FIELD_LABEL} htmlFor="vl_install">Install rate</label>
                  <input
                    id="vl_install"
                    type="number"
                    min="0"
                    step="any"
                    style={FIELD_INPUT}
                    value={installRateStr}
                    onChange={(e) => setInstallRateStr(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Live preview + actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13 }}>
          Value change:{' '}
          {preview != null ? (
            <NetChange value={preview} />
          ) : (
            <span style={{ color: 'var(--c-text-dim)' }}>—</span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" isLoading={submitting} disabled={submitting} onClick={handleSave}>
            {submitting ? 'Saving…' : 'Save line'}
          </Button>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: 'var(--c-red)', background: 'var(--c-red-dim)', border: '1px solid var(--c-red)', borderRadius: 6, padding: '8px 12px' }}>
          {error}
        </div>
      )}
    </div>
  )
}
