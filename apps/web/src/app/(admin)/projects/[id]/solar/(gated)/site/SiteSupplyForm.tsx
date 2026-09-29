'use client'
/**
 * Site & Supply (spec §3). Sections A Location · B Supply authority &
 * connection · C Roof sources (Phase 5) · D Site constraints · E Solar
 * resource (Phase 4). Not in Phase 1C: "Locate from address" (geocoding,
 * D-08), the map pin (no map component exists), roof sources / satellite /
 * calibration, the solar-resource fetch. The supply authority is free text
 * (licensee_name) until the Phase 2 tariff library replaces it with a select.
 * Saves explicitly (no auto-save); unsaved edits arm the tab-bar guard and
 * the browser's beforeunload prompt.
 */
import { useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  SOLAR_EXPORT_MODES, SOLAR_SUPPLY_TYPES, SOLAR_VOLTAGE_PRESETS, validateSiteSupply,
  type SiteSupplyField, type SiteSupplyForm as SiteForm,
} from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, Select, TextInput, Textarea } from '@/components/ui/FormField'
import { saveSolarSiteAction } from '@/actions/solar-site.actions'
import { useSolarDirtyGuard } from '@/lib/solar/dirty-store'

export interface SiteNode {
  id: string
  label: string
  kind: string
  ratingKva: number | null
}

export interface SiteSupplyFormProps {
  projectId: string
  initialForm: SiteForm
  updatedAt: string | null
  canEdit: boolean
  address: string | null
  nodes: SiteNode[]
  /** NMD proposed from the main incomer's rating when the study has none. */
  nmdPrefill: { value: string; from: string } | null
}

const PRESET_VALUES = SOLAR_VOLTAGE_PRESETS.map((p) => String(p.volts))
const EXPORT_ALLOWED = ['net_billing', 'no_credit']
const GRID: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }
const WARN: CSSProperties = { fontSize: 11, color: 'var(--c-amber)', margin: '4px 0 0' }
const HINT: CSSProperties = { fontSize: 11, color: 'var(--c-text-dim)', margin: '4px 0 0' }

function labelOf(list: ReadonlyArray<{ value: string; label: string }>, v: string): string {
  return list.find((o) => o.value === v)?.label ?? '—'
}

export function SiteSupplyForm(p: SiteSupplyFormProps) {
  const router = useRouter()
  const start = useMemo<SiteForm>(
    () => (p.nmdPrefill && !p.initialForm.nmdKva ? { ...p.initialForm, nmdKva: p.nmdPrefill.value } : p.initialForm),
    [p.initialForm, p.nmdPrefill],
  )
  const [baseline, setBaseline] = useState<SiteForm>(start)
  const [form, setForm] = useState<SiteForm>(start)
  const [token, setToken] = useState<string | null>(p.updatedAt)
  const [voltageChoice, setVoltageChoice] = useState<string>(
    start.supplyVoltageV === '' ? '' : PRESET_VALUES.includes(start.supplyVoltageV) ? start.supplyVoltageV : 'other',
  )
  const [showErrors, setShowErrors] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<SiteSupplyField, string>>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = validateSiteSupply(form)
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)
  useSolarDirtyGuard(p.canEdit && dirty)
  const errorOf = (f: SiteSupplyField) => serverErrors[f] ?? (showErrors ? check.errors[f] : undefined)
  const set = (f: SiteSupplyField) => (value: string) => {
    setForm((prev) => ({ ...prev, [f]: value }))
    setServerErrors((prev) => ({ ...prev, [f]: undefined }))
    setMessage(null)
  }
  const poc = p.nodes.find((n) => n.id === form.pocNodeId)
  const exportAllowed = EXPORT_ALLOWED.includes(form.exportMode)

  async function save() {
    setShowErrors(true)
    setError(null)
    setMessage(null)
    if (Object.keys(check.errors).length > 0) return
    setBusy(true)
    const res = await saveSolarSiteAction({ projectId: p.projectId, form, expectedUpdatedAt: token })
    setBusy(false)
    if ('fieldErrors' in res) { setServerErrors(res.fieldErrors); return }
    if ('error' in res) { setError(res.error); return }
    setToken(res.updatedAt)
    setBaseline(form)
    setShowErrors(false)
    setMessage('Saved')
    router.refresh()
  }

  const later = (title: string, body: string) => (
    <Card>
      <CardHeader><span className="data-panel-title">{title}</span></CardHeader>
      <CardBody><p style={{ ...HINT, margin: 0, fontSize: 13 }}>{body}</p></CardBody>
    </Card>
  )

  if (!p.canEdit) {
    const v = (s: string, unit = '') => (s ? `${s}${unit}` : '—')
    const row = (label: string, value: string) => (
      <div><dt style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>{label}</dt><dd style={{ margin: '2px 0 0', fontSize: 13 }}>{value}</dd></div>
    )
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Card>
          <CardHeader><span className="data-panel-title">Location and supply</span></CardHeader>
          <CardBody>
            <dl style={{ ...GRID, margin: 0 }}>
              {row('Address', p.address ?? 'No address on the project')}
              {row('Latitude', v(form.latitude))}
              {row('Longitude', v(form.longitude))}
              {row('Elevation', v(form.elevationM, ' m'))}
              {row('Supply authority', v(form.licenseeName))}
              {row('Customer type', form.supplyType ? labelOf(SOLAR_SUPPLY_TYPES, form.supplyType) : '—')}
              {row('NMD', v(form.nmdKva, ' kVA'))}
              {row('Supply voltage', v(form.supplyVoltageV, ' V'))}
              {row('Point of connection', poc?.label ?? '—')}
              {row('Export allowed?', form.exportMode ? labelOf(SOLAR_EXPORT_MODES, form.exportMode) : '—')}
              {exportAllowed && row('Export limit', v(form.exportLimitKw, ' kW'))}
              {row('Site constraints', v(form.constraintsNote))}
            </dl>
          </CardBody>
        </Card>
        {later('Roof sources — coming in a later phase', 'Roof plans from the project drawings, scale calibration and a satellite capture arrive with the PV layout tool.')}
        {later('Solar resource — coming in a later phase', 'Long-term irradiation for the site (Global Solar Atlas and PVGIS) arrives with the yield model.')}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader><span className="data-panel-title">A. Location</span></CardHeader>
        <CardBody>
          <div style={{ marginBottom: 14, fontSize: 13 }}>
            <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>Address</div>
            <span>{p.address ?? 'No address on the project'}</span>{' '}
            <Link href={`/projects/${p.projectId}/settings/site`} style={{ fontSize: 12 }}>Edit in project settings</Link>
          </div>
          <div style={GRID}>
            <div>
              <FormField label="Latitude" htmlFor="solar-lat" error={errorOf('latitude')}>
                <TextInput id="solar-lat" inputMode="decimal" value={form.latitude} onChange={(e) => set('latitude')(e.target.value)} invalid={Boolean(errorOf('latitude'))} />
              </FormField>
              {check.warnings.latitude && <p role="status" style={WARN}>{check.warnings.latitude}</p>}
            </div>
            <FormField label="Longitude" htmlFor="solar-lng" error={errorOf('longitude')}>
              <TextInput id="solar-lng" inputMode="decimal" value={form.longitude} onChange={(e) => set('longitude')(e.target.value)} invalid={Boolean(errorOf('longitude'))} />
            </FormField>
            <FormField label="Elevation (m)" htmlFor="solar-elev" error={errorOf('elevationM')} hint="Used by the weather and temperature model">
              <TextInput id="solar-elev" inputMode="decimal" value={form.elevationM} onChange={(e) => set('elevationM')(e.target.value)} />
            </FormField>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><span className="data-panel-title">B. Supply authority and connection</span></CardHeader>
        <CardBody>
          <div style={GRID}>
            <FormField label="Supply authority" htmlFor="solar-licensee" error={errorOf('licenseeName')} hint="Eskom or the municipality that bills the site">
              <TextInput id="solar-licensee" value={form.licenseeName} maxLength={200} onChange={(e) => set('licenseeName')(e.target.value)} />
            </FormField>
            <div>
              <FormField label="Customer type" htmlFor="solar-supply-type" error={errorOf('supplyType')}>
                <Select id="solar-supply-type" value={form.supplyType} onChange={(e) => set('supplyType')(e.target.value)}>
                  <option value="">Choose…</option>
                  {SOLAR_SUPPLY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </FormField>
              {form.supplyType === 'private_resale' && (
                <p style={HINT}>Resale tariff basis is set with the tariff library in a later phase.</p>
              )}
            </div>
            <div>
              <FormField label="Notified maximum demand (NMD, kVA)" htmlFor="solar-nmd" error={errorOf('nmdKva')}>
                <TextInput id="solar-nmd" inputMode="decimal" value={form.nmdKva} onChange={(e) => set('nmdKva')(e.target.value)} invalid={Boolean(errorOf('nmdKva'))} />
              </FormField>
              {p.nmdPrefill && form.nmdKva === p.nmdPrefill.value && !p.initialForm.nmdKva && (
                <p style={HINT}>Pre-filled from {p.nmdPrefill.from}</p>
              )}
            </div>
            <div>
              <FormField label="Supply voltage" htmlFor="solar-voltage" error={voltageChoice === 'other' ? undefined : errorOf('supplyVoltageV')}>
                <Select
                  id="solar-voltage"
                  value={voltageChoice}
                  onChange={(e) => {
                    const v = e.target.value
                    setVoltageChoice(v)
                    set('supplyVoltageV')(v === 'other' ? (PRESET_VALUES.includes(form.supplyVoltageV) ? '' : form.supplyVoltageV) : v)
                  }}
                >
                  <option value="">Choose…</option>
                  {SOLAR_VOLTAGE_PRESETS.map((v) => <option key={v.volts} value={String(v.volts)}>{v.label}</option>)}
                  <option value="other">Other (V)</option>
                </Select>
              </FormField>
              {voltageChoice === 'other' && (
                <div style={{ marginTop: 8 }}>
                  <FormField label="Supply voltage (V)" htmlFor="solar-voltage-other" error={errorOf('supplyVoltageV')}>
                    <TextInput id="solar-voltage-other" inputMode="numeric" value={form.supplyVoltageV} onChange={(e) => set('supplyVoltageV')(e.target.value)} />
                  </FormField>
                </div>
              )}
            </div>
            <div>
              <FormField label="Point of connection" htmlFor="solar-poc" error={errorOf('pocNodeId')} hint={p.nodes.length === 0 ? 'No main boards, mini-subs or RMUs on this project yet' : undefined}>
                <Select id="solar-poc" value={form.pocNodeId} onChange={(e) => set('pocNodeId')(e.target.value)}>
                  <option value="">Not chosen</option>
                  {p.nodes.map((n) => (
                    <option key={n.id} value={n.id}>{n.ratingKva !== null ? `${n.label} (${n.ratingKva} kVA)` : n.label}</option>
                  ))}
                </Select>
              </FormField>
              <p style={HINT}>{`Transformer / mini-sub rating: ${poc?.ratingKva != null ? `${poc.ratingKva} kVA` : '—'}`}</p>
            </div>
            <FormField label="Export allowed?" htmlFor="solar-export" error={errorOf('exportMode')}>
              <Select id="solar-export" value={form.exportMode} onChange={(e) => set('exportMode')(e.target.value)}>
                <option value="">Choose…</option>
                {SOLAR_EXPORT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Select>
            </FormField>
            {exportAllowed && (
              <FormField label="Export limit (kW)" htmlFor="solar-export-limit" error={errorOf('exportLimitKw')}>
                <TextInput id="solar-export-limit" inputMode="decimal" value={form.exportLimitKw} onChange={(e) => set('exportLimitKw')(e.target.value)} />
              </FormField>
            )}
          </div>
        </CardBody>
      </Card>

      {later('Roof sources — coming in a later phase', 'Roof plans from the project drawings, scale calibration and a satellite capture arrive with the PV layout tool.')}

      <Card>
        <CardHeader><span className="data-panel-title">D. Site constraints</span></CardHeader>
        <CardBody>
          <FormField label="Site constraints notes" htmlFor="solar-constraints" error={errorOf('constraintsNote')} hint="Shading objects, structural limits, access — printed in the report appendix">
            <Textarea id="solar-constraints" rows={4} maxLength={5000} value={form.constraintsNote} onChange={(e) => set('constraintsNote')(e.target.value)} />
          </FormField>
        </CardBody>
      </Card>

      {later('Solar resource — coming in a later phase', 'Long-term irradiation for the site (Global Solar Atlas and PVGIS) arrives with the yield model.')}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button type="button" onClick={() => void save()} isLoading={busy}>Save</Button>
        {message && <span role="status" style={{ fontSize: 12, color: 'var(--c-green)' }}>{message}</span>}
        {error && <span role="alert" style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</span>}
      </div>
    </div>
  )
}
