'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
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
import { saveTenantAssignmentAction } from './gcr.actions'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  settings: GcrSettingsRow | null
  zones: GcrZoneRow[]
  generators: GcrZoneGeneratorRow[]
  tenants: TenantNodeRow[]
  assignments: GcrTenantAssignmentRow[]
}

// ─── Per-row editable state ───────────────────────────────────────────────────

interface RowState {
  nodeId: string
  participation: GeneratorParticipation
  category: ShopCategory
  zoneId: string | null
  manualKwOverride: string // string for input binding; parsed on save
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = new Set<ShopCategory>([
  'standard', 'fast_food', 'restaurant', 'national', 'other',
])

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

function initRowState(tenants: TenantNodeRow[], assignments: GcrTenantAssignmentRow[]): Record<string, RowState> {
  const byNode: Record<string, RowState> = {}
  for (const t of tenants) {
    const asgn = assignments.find((a) => a.node_id === t.id)
    const rawCat = t.shop_category ?? ''
    const category: ShopCategory = VALID_CATEGORIES.has(rawCat as ShopCategory)
      ? (rawCat as ShopCategory)
      : 'standard'
    byNode[t.id] = {
      nodeId: t.id,
      participation: t.generator_participation,
      category,
      zoneId: asgn?.zone_id ?? null,
      manualKwOverride: asgn?.manual_kw_override != null ? String(asgn.manual_kw_override) : '',
    }
  }
  return byNode
}

// ─── TenantsPanel ─────────────────────────────────────────────────────────────

export function TenantsPanel({ projectId, settings, zones, generators, tenants, assignments }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const engineSettings = useMemo(() => settingsToEngine(settings), [settings])

  // Local editable state per row — seeded from props
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    initRowState(tenants, assignments),
  )

  // Per-row save error
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  // ─── Readiness check ───────────────────────────────────────────────────────

  const readiness = useMemo(() => {
    // Build TenantNodeRow[] from current local state for the readiness check
    const tenantNodes: TenantNodeRow[] = tenants.map((t) => {
      const rs = rows[t.id]
      return {
        id: t.id,
        shop_number: t.shop_number,
        shop_name: t.shop_name ?? '',
        shop_area_m2: t.shop_area_m2,
        shop_category: rs?.category ?? t.shop_category,
        generator_participation: rs?.participation ?? t.generator_participation,
      }
    })
    return checkReadiness({
      settings,
      zones,
      generators,
      tenantNodes,
    })
  }, [settings, zones, generators, tenants, rows])

  // ─── Row update helper ──────────────────────────────────────────────────────

  function updateRow(nodeId: string, patch: Partial<RowState>) {
    setRows((prev) => ({
      ...prev,
      [nodeId]: { ...prev[nodeId], ...patch },
    }))
  }

  // ─── Save a row ─────────────────────────────────────────────────────────────

  function saveRow(nodeId: string) {
    const rs = rows[nodeId]
    if (!rs) return
    const manualOverride = rs.manualKwOverride.trim() !== '' ? parseFloat(rs.manualKwOverride) : null
    if (rs.manualKwOverride.trim() !== '' && (manualOverride === null || isNaN(manualOverride))) {
      setRowErrors((prev) => ({ ...prev, [nodeId]: 'Invalid kW override.' }))
      return
    }
    setRowErrors((prev) => { const n = { ...prev }; delete n[nodeId]; return n })

    startTransition(async () => {
      const res = await saveTenantAssignmentAction(projectId, {
        node_id: nodeId,
        zone_id: rs.zoneId,
        participation: rs.participation,
        manual_kw_override: manualOverride,
        shop_category: rs.category,
      })
      if ('error' in res) {
        setRowErrors((prev) => ({ ...prev, [nodeId]: res.error }))
      } else {
        router.refresh()
      }
    })
  }

  // ─── Sorted tenants ─────────────────────────────────────────────────────────

  const sorted = useMemo(
    () =>
      [...tenants].sort((a, b) =>
        (a.shop_number ?? '').localeCompare(b.shop_number ?? '', undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      ),
    [tenants],
  )

  const busy = isPending

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
            {readiness.ready ? (
              <a
                href={`/api/projects/${projectId}/generator-cost-recovery/report-preview`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '5px 12px',
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: 'var(--font-sans)',
                  borderRadius: 6,
                  border: '1px solid var(--c-border)',
                  background: 'var(--c-panel)',
                  color: 'var(--c-text)',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
              >
                Generate report
              </a>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled
                title={readiness.gaps.join(' · ')}
                style={{ opacity: 0.45, cursor: 'not-allowed' }}
              >
                Generate report
              </Button>
            )}
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
          </CardBody>
        )}
      </Card>

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
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                  <th style={TH}>Shop #</th>
                  <th style={TH}>Name</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Area (m²)</th>
                  <th style={TH}>Category</th>
                  <th style={TH}>Participation</th>
                  <th style={TH}>Zone</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Manual kW</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Loading kW</th>
                  <th style={{ ...TH, width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((tenant) => {
                  const rs = rows[tenant.id]
                  if (!rs) return null

                  const isOptOut = rs.participation === 'own' || rs.participation === 'none'
                  const manualNum = rs.manualKwOverride.trim() !== '' ? parseFloat(rs.manualKwOverride) : null
                  const loadingKw = isOptOut
                    ? 0
                    : calculateTenantLoadingKw(
                        {
                          shopNumber: tenant.shop_number,
                          shopName: tenant.shop_name ?? '',
                          areaM2: tenant.shop_area_m2 ?? 0,
                          category: rs.category,
                          participation: rs.participation,
                          manualKwOverride: manualNum != null && !isNaN(manualNum) ? manualNum : null,
                        },
                        engineSettings,
                      )

                  const rowError = rowErrors[tenant.id]

                  return (
                    <tr
                      key={tenant.id}
                      style={{
                        borderTop: '1px solid var(--c-border)',
                        opacity: isOptOut ? 0.55 : 1,
                        background: isOptOut ? 'var(--c-panel-dim, rgba(0,0,0,0.03))' : undefined,
                      }}
                    >
                      <td style={TD}>{tenant.shop_number}</td>
                      <td style={{ ...TD, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tenant.shop_name ?? '—'}
                      </td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        {tenant.shop_area_m2 != null ? tenant.shop_area_m2.toLocaleString('en-ZA') : '—'}
                      </td>

                      {/* Category */}
                      <td style={TD}>
                        <select
                          value={rs.category}
                          onChange={(e) => updateRow(tenant.id, { category: e.target.value as ShopCategory })}
                          onBlur={() => saveRow(tenant.id)}
                          disabled={busy}
                          style={SELECT_STYLE}
                        >
                          {(Object.keys(CATEGORY_LABELS) as ShopCategory[]).map((cat) => (
                            <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                          ))}
                        </select>
                      </td>

                      {/* Participation — 3-way segmented control */}
                      <td style={TD}>
                        <div style={{ display: 'flex', gap: 2 }}>
                          {PARTICIPATION_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                updateRow(tenant.id, { participation: opt.value })
                                // save immediately on click
                                startTransition(async () => {
                                  const rs2 = { ...rows[tenant.id], participation: opt.value }
                                  const manualN = rs2.manualKwOverride.trim() !== '' ? parseFloat(rs2.manualKwOverride) : null
                                  await saveTenantAssignmentAction(projectId, {
                                    node_id: tenant.id,
                                    zone_id: rs2.zoneId,
                                    participation: opt.value,
                                    manual_kw_override: manualN != null && !isNaN(manualN) ? manualN : null,
                                    shop_category: rs2.category,
                                  })
                                  router.refresh()
                                })
                              }}
                              style={{
                                padding: '3px 8px',
                                fontSize: 11,
                                fontFamily: 'var(--font-sans)',
                                fontWeight: rs.participation === opt.value ? 600 : 400,
                                borderRadius: 4,
                                border: '1px solid var(--c-border)',
                                background: rs.participation === opt.value
                                  ? 'var(--c-amber)'
                                  : 'var(--c-panel)',
                                color: rs.participation === opt.value
                                  ? 'var(--c-text-on-amber, #0D0B09)'
                                  : 'var(--c-text-mid)',
                                cursor: busy ? 'not-allowed' : 'pointer',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </td>

                      {/* Zone */}
                      <td style={TD}>
                        <select
                          value={rs.zoneId ?? ''}
                          onChange={(e) => updateRow(tenant.id, { zoneId: e.target.value || null })}
                          onBlur={() => saveRow(tenant.id)}
                          disabled={busy}
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

                      {/* Manual kW override */}
                      <td style={{ ...TD, textAlign: 'right' }}>
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          value={rs.manualKwOverride}
                          onChange={(e) => updateRow(tenant.id, { manualKwOverride: e.target.value })}
                          onBlur={() => saveRow(tenant.id)}
                          disabled={busy}
                          placeholder="—"
                          style={{
                            ...SELECT_STYLE,
                            width: 90,
                            textAlign: 'right',
                          }}
                        />
                      </td>

                      {/* Loading kW — computed live */}
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

                      {/* Row error indicator */}
                      <td style={TD}>
                        {rowError && (
                          <span
                            title={rowError}
                            style={{ fontSize: 11, color: 'var(--c-red)', cursor: 'help' }}
                          >
                            ⚠
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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
