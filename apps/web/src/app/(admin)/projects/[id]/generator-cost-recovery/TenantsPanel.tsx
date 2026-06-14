'use client'

import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { TableScrollX } from '@/components/ui/TableScrollX'
import {
  calculateTenantLoadingKw,
  checkReadiness,
  DEFAULT_GENERATOR_SETTINGS,
  type GeneratorSettings,
  type ShopCategory,
  type GeneratorParticipation,
  type GcrSettingsRow,
  type GcrZoneRow,
  type GcrZoneGeneratorRow,
  type TenantNodeRow,
  type GcrTenantAssignmentRow,
} from '@esite/shared'
import { bulkSetUncategorizedTenantsAction } from './gcr.actions'
import { useAssignmentSaves } from './useAssignmentSaves'
import { toDisplayTenant, matchesFilter, filterCounts, zoneCoverage, type DisplayTenant, type TenantFilter } from './tenant-display'
import { BulkBar } from './BulkBar'
import { CoverageStrip } from './CoverageStrip'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  settings: GcrSettingsRow | null
  zones: GcrZoneRow[]
  generators: GcrZoneGeneratorRow[]
  tenants: TenantNodeRow[]
  assignments: GcrTenantAssignmentRow[]
  /** Report generation lives on the Reports tab — this switches to it. */
  onNavigateToReports: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<ShopCategory, string> = {
  standard:   'Standard',
  fast_food:  'Fast food',
  restaurant: 'Restaurant',
  national:   'National',
  other:      'Other',
}

const PARTICIPATION_OPTIONS: { value: GeneratorParticipation; label: string }[] = [
  { value: 'shared',  label: 'Shared' },
  { value: 'own',     label: 'Own generator' },
  { value: 'none',    label: 'Not on generator' },
]

/** NaN or negative draft — blocked from saving (patch schema is nonnegative). */
function kwDraftInvalid(draft: string): boolean {
  const trimmed = draft.trim()
  if (trimmed === '') return false
  const v = parseFloat(trimmed)
  return Number.isNaN(v) || v < 0
}

function settingsToEngine(raw: GcrSettingsRow | null): GeneratorSettings {
  if (!raw) return DEFAULT_GENERATOR_SETTINGS
  return {
    standardKwPerSqm:             raw.standard_kw_per_sqm,
    fastFoodKwPerSqm:             raw.fast_food_kw_per_sqm,
    restaurantKwPerSqm:           raw.restaurant_kw_per_sqm,
    nationalKwPerSqm:             raw.national_kw_per_sqm,
    capitalRecoveryPeriodYears:   raw.capital_recovery_period_years,
    capitalRecoveryRatePercent:   raw.capital_recovery_rate_percent,
    ratePerTenantDb:              raw.rate_per_tenant_db,
    numMainBoards:                raw.num_main_boards,
    ratePerMainBoard:             raw.rate_per_main_board,
    additionalCablingCost:        raw.additional_cabling_cost,
    controlWiringCost:            raw.control_wiring_cost,
    dieselCostPerLitre:           raw.diesel_cost_per_litre,
    runningHoursPerMonth:         raw.running_hours_per_month,
    maintenanceCostAnnual:        raw.maintenance_cost_annual,
    powerFactor:                  raw.power_factor,
    runningLoadPercentage:        raw.running_load_percentage,
    maintenanceContingencyPercent:raw.maintenance_contingency_percent,
  }
}

// ─── TenantsPanel ─────────────────────────────────────────────────────────────

export function TenantsPanel({ projectId, settings, zones, generators, tenants, assignments, onNavigateToReports }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition() // bulk-categorize only

  const engineSettings = useMemo(() => settingsToEngine(settings), [settings])

  const { pending, status, commit, commitWithResult, retry, reconcile } = useAssignmentSaves(projectId)

  // kW drafts: text being typed, committed on Enter/blur
  const [kwDrafts, setKwDrafts] = useState<Record<string, string>>({})

  const assignmentsByNode = useMemo(() => {
    const m = new Map<string, GcrTenantAssignmentRow>()
    for (const a of assignments) m.set(a.node_id, a)
    return m
  }, [assignments])

  // Display model: server truth + pending overlay (recomputed every render —
  // router.refresh() therefore reconciles the screen automatically).
  const displayed: DisplayTenant[] = useMemo(
    () => tenants.map((t) => toDisplayTenant(t, assignmentsByNode.get(t.id), pending[t.id])),
    [tenants, assignmentsByNode, pending],
  )

  // Drop pending entries the server has caught up with.
  useEffect(() => {
    reconcile((nodeId, patch) => {
      const node = tenants.find((t) => t.id === nodeId)
      if (!node) return true
      const server = toDisplayTenant(node, assignmentsByNode.get(nodeId), undefined)
      return (
        (patch.zone_id === undefined || server.zoneId === patch.zone_id) &&
        (patch.participation === undefined || server.participation === patch.participation) &&
        (patch.shop_category === undefined || server.category === patch.shop_category) &&
        (patch.manual_kw_override === undefined || server.manualKwOverride === patch.manual_kw_override)
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenants, assignmentsByNode])

  function commitKw(t: DisplayTenant) {
    const draft = kwDrafts[t.id]
    if (draft === undefined) return
    const trimmed = draft.trim()
    const value = trimmed === '' ? null : parseFloat(trimmed)
    // NaN or negative: leave the draft + pending dot in place — no save.
    // The patch schema is strict (z.number().nonnegative().nullable()).
    if (value !== null && (Number.isNaN(value) || value < 0)) return
    setKwDrafts((prev) => { const n = { ...prev }; delete n[t.id]; return n })
    if (value !== t.manualKwOverride) commit([t.id], { manual_kw_override: value })
  }

  // Bulk-categorize state
  const [bulkError, setBulkError] = useState<string | null>(null)
  const uncategorizedCount = useMemo(
    () => displayed.filter((t) => t.category === null).length,
    [displayed],
  )

  function handleBulkCategorize() {
    setBulkError(null)
    startTransition(async () => {
      const res = await bulkSetUncategorizedTenantsAction(projectId)
      if ('error' in res) {
        setBulkError(res.error)
        return
      }
      router.refresh()
    })
  }

  // ─── Readiness check (derived from the display model) ──────────────────────

  const readiness = useMemo(() => {
    const tenantNodes: TenantNodeRow[] = displayed.map((t) => ({
      id: t.id,
      shop_number: t.shop_number ?? '',
      shop_name: t.shop_name ?? '',
      shop_area_m2: t.shop_area_m2,
      shop_category: t.category,
      generator_participation: t.participation,
    }))
    return checkReadiness({
      settings,
      zones,
      generators,
      tenantNodes,
    })
  }, [settings, zones, generators, displayed])

  // ─── Filter state ────────────────────────────────────────────────────────────

  const [filter, setFilter] = useState<TenantFilter>('all')
  const counts = useMemo(() => filterCounts(displayed), [displayed])
  const setupCount = counts.needs_setup

  // ─── Coverage (per-zone summary shown above the filter chips) ───────────────

  const coverage = useMemo(
    () => zoneCoverage(displayed, zones, generators, engineSettings),
    [displayed, zones, generators, engineSettings],
  )

  // ─── Sorted display rows (filter-aware) ─────────────────────────────────────

  const displayedSorted = useMemo(
    () =>
      [...displayed]
        .filter((t) => matchesFilter(t, filter))
        .sort((a, b) =>
          (a.shop_number ?? '').localeCompare(b.shop_number ?? '', undefined, {
            numeric: true,
            sensitivity: 'base',
          }),
        ),
    [displayed, filter],
  )

  // ─── Row selection ───────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function applyFilter(f: TenantFilter) {
    setFilter(f)
    setSelected(new Set())
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(displayedSorted.map((t) => t.id)) : new Set())
  }
  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n })
  }

  const busy = isPending // bulk-categorize button only — row saves never disable controls

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Readiness summary */}
      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
              {readiness.ready ? 'Ready to generate' : 'Not ready'}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={onNavigateToReports}
              title={readiness.ready ? undefined : readiness.gaps.join(' · ')}
            >
              Go to Reports
            </Button>
          </div>
        </CardHeader>
        {!readiness.ready && (
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {readiness.gaps.map((gap) => (
                <li key={gap} style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>
                  {gap}
                </li>
              ))}
            </ul>
            {uncategorizedCount > 0 && (
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Button size="sm" variant="primary" onClick={handleBulkCategorize} disabled={busy}>
                  Set all uncategorized to Standard ({uncategorizedCount})
                </Button>
                <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
                  Then change individual shops (fast food, restaurant, national) below.
                </span>
              </div>
            )}
            {bulkError && (
              <div role="alert" style={{ marginTop: 8, fontSize: 13, color: 'var(--c-red)' }}>
                {bulkError}
              </div>
            )}
          </CardBody>
        )}
      </Card>

      {/* Needs-setup banner — always visible when shops are unconfigured,
          regardless of overall readiness (readiness can be gated on other gaps). */}
      {setupCount > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            padding: '10px 14px',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            background: 'var(--c-panel)',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>
            {setupCount} shops need setup (zone or category missing).
          </span>
          <Button size="sm" variant="secondary" onClick={() => applyFilter('needs_setup')}>Show</Button>
        </div>
      )}

      {/* Tenants table */}
      {tenants.length === 0 ? (
        <div
          style={{
            padding: '32px 18px',
            textAlign: 'center',
            color: 'var(--c-text-dim)',
            fontSize: 13,
            fontStyle: 'italic',
          }}
        >
          No tenant nodes found for this project.
        </div>
      ) : (
        <Card>
          <CoverageStrip perZone={coverage.perZone} configured={coverage.configured} total={coverage.total} />
          <BulkBar
            selectedIds={[...selected]}
            zones={zones}
            onApply={(p, ids) => commitWithResult(ids, p)}
            onClear={() => setSelected(new Set())}
          />
          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 12px', borderBottom: '1px solid var(--c-border)' }}>
            {([
              { key: 'all' as const,          label: `All (${counts.all})` },
              { key: 'needs_setup' as const,   label: `Needs setup (${counts.needs_setup})` },
              { key: 'no_zone' as const,       label: `No zone (${counts.no_zone})` },
              { key: 'uncategorized' as const, label: `Uncategorized (${counts.uncategorized})` },
              { key: 'opted_out' as const,     label: `Opted out (${counts.opted_out})` },
            ]).map((c) => (
              <button key={c.key} type="button" aria-pressed={filter === c.key} onClick={() => applyFilter(c.key)} style={chipStyle(filter === c.key)}>
                {c.label}
              </button>
            ))}
            {zones.map((z) => (
              <button
                key={z.id}
                type="button"
                aria-pressed={typeof filter === 'object' && filter.zoneId === z.id}
                onClick={() => applyFilter({ zoneId: z.id })}
                style={chipStyle(typeof filter === 'object' && filter.zoneId === z.id)}
              >
                {z.zone_name} ({counts.byZone[z.id] ?? 0})
              </button>
            ))}
          </div>
          <TableScrollX>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                  <th style={{ ...TH, width: 34 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all visible shops"
                      checked={displayedSorted.length > 0 && selected.size === displayedSorted.length}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                  </th>
                  <th style={TH}>Shop #</th>
                  <th style={TH}>Name</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Area (m²)</th>
                  <th style={TH}>Category</th>
                  <th style={TH}>Participation</th>
                  <th style={TH}>Zone</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Manual kW</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Loading kW</th>
                  <th style={{ ...TH, width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {displayedSorted.map((t) => {
                  const isOptOut = t.participation === 'own' || t.participation === 'none'
                  const loadingKw = isOptOut
                    ? 0
                    : calculateTenantLoadingKw(
                        {
                          shopNumber: t.shop_number ?? '',
                          shopName: t.shop_name ?? '',
                          areaM2: t.shop_area_m2 ?? 0,
                          // Engine semantics: uncategorized prices as standard (from-db.ts).
                          category: t.category ?? 'standard',
                          participation: t.participation,
                          manualKwOverride: t.manualKwOverride,
                        },
                        engineSettings,
                      )

                  const rowStatus = status[t.id]

                  return (
                    <tr
                      key={t.id}
                      style={{
                        borderTop: '1px solid var(--c-border)',
                        opacity: isOptOut ? 0.55 : 1,
                        background: isOptOut ? 'var(--c-panel-dim, rgba(0,0,0,0.03))' : undefined,
                      }}
                    >
                      <td style={TD}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${t.shop_number ?? t.id}`}
                          checked={selected.has(t.id)}
                          onChange={(e) => toggleOne(t.id, e.target.checked)}
                        />
                      </td>
                      <td style={TD}>{t.shop_number}</td>
                      <td style={{ ...TD, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.shop_name ?? '—'}
                      </td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        {t.shop_area_m2 != null ? t.shop_area_m2.toLocaleString('en-ZA') : '—'}
                      </td>

                      {/* Category — commits on change; null renders an explicit placeholder, never a fake default */}
                      <td style={TD}>
                        <select
                          aria-label={`Category for ${t.shop_number ?? t.id}`}
                          value={t.category ?? ''}
                          onChange={(e) => commit([t.id], { shop_category: (e.target.value || null) as ShopCategory | null })}
                          style={{
                            ...SELECT_STYLE,
                            ...(t.category === null
                              ? { borderColor: 'var(--c-amber)', color: 'var(--c-text-dim)', fontStyle: 'italic' }
                              : null),
                          }}
                        >
                          {t.category === null && (
                            <option value="" disabled>
                              — set category —
                            </option>
                          )}
                          {(Object.keys(CATEGORY_LABELS) as ShopCategory[]).map((cat) => (
                            <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                          ))}
                        </select>
                      </td>

                      {/* Participation — segmented control, commits on click, aria-pressed reflects display value */}
                      <td style={TD}>
                        <div style={{ display: 'flex', gap: 2 }}>
                          {PARTICIPATION_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              aria-pressed={t.participation === opt.value}
                              onClick={() => { if (t.participation !== opt.value) commit([t.id], { participation: opt.value }) }}
                              style={{
                                padding: '3px 8px',
                                fontSize: 11,
                                fontFamily: 'var(--font-sans)',
                                fontWeight: t.participation === opt.value ? 600 : 400,
                                borderRadius: 4,
                                border: '1px solid var(--c-border)',
                                background: t.participation === opt.value
                                  ? 'var(--c-amber)'
                                  : 'var(--c-panel)',
                                color: t.participation === opt.value
                                  ? 'var(--c-text-on-amber, #0D0B09)'
                                  : 'var(--c-text-mid)',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </td>

                      {/* Zone — commits on change */}
                      <td style={TD}>
                        <select
                          aria-label={`Zone for ${t.shop_number ?? t.id}`}
                          value={t.zoneId ?? ''}
                          onChange={(e) => commit([t.id], { zone_id: e.target.value || null })}
                          style={SELECT_STYLE}
                        >
                          <option value="">—</option>
                          {zones.map((z) => (
                            <option key={z.id} value={z.id}>
                              {z.zone_name}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Manual kW — draft → Enter/blur commit; dot while draft differs */}
                      <td style={{ ...TD, textAlign: 'right' }}>
                        <input
                          aria-label={`Manual kW for ${t.shop_number ?? t.id}`}
                          type="number"
                          step="0.01"
                          min={0}
                          value={kwDrafts[t.id] ?? (t.manualKwOverride != null ? String(t.manualKwOverride) : '')}
                          onChange={(e) => setKwDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitKw(t) }}
                          onBlur={() => commitKw(t)}
                          placeholder="—"
                          style={{
                            ...SELECT_STYLE,
                            width: 90,
                            textAlign: 'right',
                          }}
                        />
                        {kwDrafts[t.id] !== undefined && (
                          kwDraftInvalid(kwDrafts[t.id]) ? (
                            <span title="Invalid kW — enter a non-negative number" style={{ color: 'var(--c-red)' }}> ●</span>
                          ) : (
                            <span title="Not saved yet — press Enter" style={{ color: 'var(--c-amber)' }}> ●</span>
                          )
                        )}
                      </td>

                      {/* Loading kW — computed live from the display model */}
                      <td
                        style={{
                          ...TD,
                          textAlign: 'right',
                          color: isOptOut ? 'var(--c-text-dim)' : 'var(--c-text)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {loadingKw.toFixed(2)}
                      </td>

                      {/* Row save status */}
                      <td style={{ ...TD, width: 90 }}>
                        {rowStatus?.state === 'saving' && (
                          <span role="status" style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>Saving…</span>
                        )}
                        {rowStatus?.state === 'saved' && (
                          <span role="status" style={{ fontSize: 11, color: 'var(--c-green, #16a34a)' }}>✓ Saved</span>
                        )}
                        {rowStatus?.state === 'error' && (
                          <span role="alert" style={{ fontSize: 11, color: 'var(--c-red)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <span title={rowStatus.message}>
                              ⚠{' '}
                              <span
                                style={{
                                  maxWidth: 160,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  display: 'inline-block',
                                  verticalAlign: 'bottom',
                                }}
                              >
                                {rowStatus.message}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => retry(t.id)}
                              style={{ fontSize: 11, textDecoration: 'underline', background: 'none', border: 'none', color: 'var(--c-red)', cursor: 'pointer' }}
                            >
                              Retry
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableScrollX>
        </Card>
      )}
    </div>
  )
}

// ─── Style constants ──────────────────────────────────────────────────────────

const TH: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--c-text-dim)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
}

const TD: React.CSSProperties = {
  padding: '7px 10px',
  fontSize: 13,
  color: 'var(--c-text)',
  verticalAlign: 'middle',
}

const SELECT_STYLE: React.CSSProperties = {
  fontSize: 12,
  padding: '4px 6px',
  borderRadius: 4,
  border: '1px solid var(--c-border)',
  background: 'var(--c-input)',
  color: 'var(--c-text)',
  fontFamily: 'var(--font-sans)',
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 999,
    cursor: 'pointer',
    border: '1px solid var(--c-border)',
    background: active ? 'var(--c-amber)' : 'var(--c-panel)',
    color: active ? 'var(--c-text-on-amber, #0D0B09)' : 'var(--c-text-mid)',
    fontWeight: active ? 600 : 400,
    fontFamily: 'var(--font-sans)',
  }
}
