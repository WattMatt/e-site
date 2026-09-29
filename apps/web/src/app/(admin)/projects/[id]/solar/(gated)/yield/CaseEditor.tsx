'use client'
/**
 * Case editor (functional spec §7.2). Holds the draft config; Save sends it (the server validates and
 * re-derives catalogue snapshots); Run runs the SAVED inputs, so it is disabled while the draft is dirty.
 * Nothing here computes a result — the DC/AC ratio shown is a ratio of two INPUTS (spec: "derived, not an input").
 */
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SolarAccessLevel } from '@esite/shared'
import type { CaseConfig } from '@esite/shared/solar-cases'
import { Button } from '@/components/ui/Button'
import { saveSolarCaseAction, fetchSolarWeatherAction } from '@/actions/solar-cases.actions'
import type { CaseEditorData, EquipmentOptions } from '@/lib/solar/cases/page-data'
import { useSolarDirtyGuard } from '@/lib/solar/dirty-store'
import { useArmedConfirm } from '../../_components/useArmedConfirm'
import { postCancel, postRun } from '../../_components/runCase'
import { mwh, num, sastDate } from '@/components/solar/format'
import { Check, NumField, Section } from './editor-fields'

const EXPORT_MODE: Record<string, string> = { net_billing: 'net billing', no_credit: 'export without credit', zero_export: 'zero export' }
const grid = { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' } as const
const dim = { fontSize: 12, color: 'var(--c-text-dim)' } as const
const alert = { color: 'var(--c-red, #dc2626)', fontSize: 12 } as const

/**
 * The export fields an override STARTS from: what the study already says (mirrors build-input's
 * non-override branch), so turning Override on changes nothing until the user edits a field. Without
 * this a "Yes (no credit)" study became credited export the moment Override was ticked.
 * No inherited mode → keep whatever the case already carries.
 */
function inheritedExport(study: CaseEditorData['studyExport']): Partial<CaseConfig['grid']> {
  switch (study.mode) {
    case 'zero_export': return { exportAllowed: false, exportLimitKw: null, exportCredited: true }
    case 'no_credit': return { exportAllowed: true, exportLimitKw: study.limitKw, exportCredited: false }
    case 'net_billing': return { exportAllowed: true, exportLimitKw: study.limitKw, exportCredited: true }
    default: return {}
  }
}

export function CaseEditor({ projectId, level, data, equipment }: { projectId: string; level: SolarAccessLevel; data: CaseEditorData; equipment: EquipmentOptions }) {
  const router = useRouter()
  const ro = level === 'view'
  const [cfg, setCfg] = useState<CaseConfig>(data.config)
  const [saved, setSaved] = useState<CaseConfig>(data.config)
  const [weather, setWeather] = useState(data.weather)
  const [updatedAt, setUpdatedAt] = useState(data.updatedAt)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'run' | 'weather' | null>(null)
  const discard = useArmedConfirm()
  const dirty = useMemo(() => JSON.stringify(cfg) !== JSON.stringify(saved), [cfg, saved])
  useSolarDirtyGuard(dirty)

  const set = <K extends keyof CaseConfig>(k: K, patch: Partial<CaseConfig[K]>) => setCfg((c) => ({ ...c, [k]: { ...(c[k] as object), ...patch } }))
  const n = (v: number | null) => (v === null ? Number.NaN : v)
  // Field errors are keyed by dotted zod paths ('pv.dcKwp'); any that no rendered field claims are listed below.
  const placed = new Set<string>()
  const err = (key: string) => { placed.add(key); return errors[key] }

  const save = async () => {
    setBusy('save'); setErrors({}); setMessage(null)
    const r = await saveSolarCaseAction({ projectId, caseId: data.caseId, config: cfg, expectedUpdatedAt: updatedAt })
    setBusy(null)
    if ('ok' in r) { setSaved(cfg); setUpdatedAt(r.updatedAt); setMessage('Saved.'); router.refresh() }
    else if ('fieldErrors' in r) setErrors(r.fieldErrors)
    else setMessage(r.error)
  }
  const run = async () => {
    setBusy('run'); setMessage(null)
    const r = await postRun(projectId, data.caseId)
    setBusy(null)
    if (!r.ok) setMessage(r.error)
    router.refresh()
  }
  const cancel = async () => {
    const r = await postCancel(projectId, data.caseId)
    if (!r.ok) setMessage(r.error)
  }
  const fetchWeather = async () => {
    setBusy('weather'); setMessage(null)
    const r = await fetchSolarWeatherAction({ projectId })
    setBusy(null)
    if ('ok' in r) {
      setWeather({ id: r.dataset.id, latRound: r.dataset.latRound, lngRound: r.dataset.lngRound, fetchedAt: r.dataset.fetchedAt, radiationDb: r.dataset.radiationDb, gsaPvoutKwhPerKwp: r.dataset.gsaPvoutKwhPerKwp })
      set('weather', { datasetId: r.dataset.id })
    } else setMessage(r.error)
  }

  const b = cfg.battery, l = cfg.losses, g = cfg.grid
  const live = <T extends { id: string; retired: boolean }>(opts: T[], current: string | undefined) => opts.filter((m) => !m.retired || m.id === current)
  const pickModule = (id: string) => {
    const m = equipment.modules.find((x) => x.id === id)
    set('pv', { module: m ? { equipmentId: m.id, make: m.make, model: m.model, pmaxW: Number(m.specs.pmaxW), gammaPmaxPctPerC: Number(m.specs.gammaPmaxPctPerC) } : null })
  }
  const pickInverter = (id: string) => {
    const m = equipment.inverters.find((x) => x.id === id)
    set('pv', { inverter: m ? { equipmentId: m.id, make: m.make, model: m.model, acKw: Number(m.specs.acKw), euroEfficiencyPct: Number(m.specs.euroEfficiencyPct) } : null })
  }
  const pickBattery = (id: string) => {
    const m = equipment.batteries.find((x) => x.id === id)
    set('battery', m
      ? { unit: { equipmentId: m.id, make: m.make, model: m.model, usableKwh: Number(m.specs.usableKwh), powerKw: Number(m.specs.powerKw), rtePct: Number(m.specs.rtePct) }, usableKwh: Number(m.specs.usableKwh), maxChargeKw: Number(m.specs.powerKw), maxDischargeKw: Number(m.specs.powerKw), rtePct: Number(m.specs.rtePct) }
      : { unit: null })
  }
  const moduleOpts = live(equipment.modules, cfg.pv.module?.equipmentId)
  const ratio = cfg.pv.acKw > 0 && Number.isFinite(cfg.pv.dcKwp) ? cfg.pv.dcKwp / cfg.pv.acKw : null
  const blocked = data.buildReasons.length > 0
  const running = busy === 'run' || data.running

  const form = (
    <>
      <Section title="PV system">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label><input type="radio" aria-label="Manual" checked readOnly disabled={ro} /> Manual</label>
          <label><input type="radio" aria-label="From layout" disabled /> From layout <span style={dim}>(arrives with the Layout tab)</span></label>
        </div>
        <div style={grid}>
          <NumField label="DC size" unit="kWp" value={cfg.pv.dcKwp} disabled={ro} error={err('pv.dcKwp')} onChange={(v) => set('pv', { dcKwp: n(v) })} />
          <NumField label="AC size" unit="kW" value={cfg.pv.acKw} disabled={ro} error={err('pv.acKw')} onChange={(v) => set('pv', { acKw: n(v) })} />
          <NumField label="Tilt" unit="°" value={cfg.pv.tiltDeg} disabled={ro} error={err('pv.tiltDeg')} onChange={(v) => set('pv', { tiltDeg: n(v) })} />
          <NumField label="Azimuth (0 = north)" unit="°" value={cfg.pv.azimuthDeg} disabled={ro} error={err('pv.azimuthDeg')} onChange={(v) => set('pv', { azimuthDeg: n(v) })} />
          <label style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 12 }}>Mounting</span><select aria-label="Mounting" disabled={ro} value={cfg.pv.mounting} onChange={(e) => set('pv', { mounting: e.target.value as 'racked' | 'flush' })}><option value="racked">Racked</option><option value="flush">Flush</option></select></label>
          <label style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 12 }}>Module type</span><select aria-label="Module type" disabled={ro} value={cfg.pv.module?.equipmentId ?? ''} onChange={(e) => pickModule(e.target.value)}>
            <option value="">Choose…</option>
            {moduleOpts.map((m) => <option key={m.id} value={m.id}>{m.make} {m.model}{m.retired ? ' (retired)' : ''}</option>)}
            {cfg.pv.module && !moduleOpts.some((m) => m.id === cfg.pv.module!.equipmentId) && <option value={cfg.pv.module.equipmentId}>{cfg.pv.module.make} {cfg.pv.module.model}</option>}
          </select></label>
          <label style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 12 }}>Inverter</span><select aria-label="Inverter" disabled={ro} value={cfg.pv.inverter?.equipmentId ?? ''} onChange={(e) => pickInverter(e.target.value)}>
            <option value="">Generic (97.5 % Euro efficiency)</option>
            {live(equipment.inverters, cfg.pv.inverter?.equipmentId).map((m) => <option key={m.id} value={m.id}>{m.make} {m.model}{m.retired ? ' (retired)' : ''}</option>)}
            {cfg.pv.inverter && !equipment.inverters.some((m) => m.id === cfg.pv.inverter!.equipmentId) && <option value={cfg.pv.inverter.equipmentId}>{cfg.pv.inverter.make} {cfg.pv.inverter.model}</option>}
          </select></label>
        </div>
        {err('pv.module') && <span role="alert" style={alert}>{errors['pv.module']}</span>}
        {err('pv.inverter') && <span role="alert" style={alert}>{errors['pv.inverter']}</span>}
        {ratio !== null && <span>{`DC/AC ratio ${ratio.toFixed(2)} (derived)`}</span>}
      </Section>

      <Section title="Losses">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 12 }}>Mode</span><select aria-label="Loss mode" disabled={ro} value={l.mode} onChange={(e) => set('losses', { mode: e.target.value as 'standard' | 'detailed' })}><option value="standard">Standard</option><option value="detailed">Detailed</option></select></label>
          {!ro && <Button type="button" size="sm" variant="secondary" onClick={() => set('losses', { ...data.defaultLosses[cfg.pv.mounting], mode: l.mode })}>Reset to defaults</Button>}
        </div>
        <div style={grid}>
          <NumField label="Soiling" unit="%" value={l.soilingPct} disabled={ro} error={err('losses.soilingPct')} onChange={(v) => set('losses', { soilingPct: n(v) })} />
          <NumField label="Near shading" unit="%" value={l.shadingPct} disabled={ro} error={err('losses.shadingPct')} onChange={(v) => set('losses', { shadingPct: n(v) })} />
          <NumField label="Mismatch" unit="%" value={l.mismatchPct} disabled={ro} error={err('losses.mismatchPct')} onChange={(v) => set('losses', { mismatchPct: n(v) })} />
          <NumField label="DC wiring" unit="%" value={l.dcWiringPct} disabled={ro} error={err('losses.dcWiringPct')} onChange={(v) => set('losses', { dcWiringPct: n(v) })} />
          <NumField label="AC wiring" unit="%" value={l.acWiringPct} disabled={ro} error={err('losses.acWiringPct')} onChange={(v) => set('losses', { acWiringPct: n(v) })} />
          <NumField label="LID / LeTID" unit="%" value={l.lidPct} disabled={ro} error={err('losses.lidPct')} onChange={(v) => set('losses', { lidPct: n(v) })} />
          <NumField label="Availability" unit="%" value={l.availabilityPct} disabled={ro} error={err('losses.availabilityPct')} onChange={(v) => set('losses', { availabilityPct: n(v) })} />
          {l.mode === 'detailed' && <>
            <NumField label="Nameplate" unit="%" value={l.nameplatePct} disabled={ro} error={err('losses.nameplatePct')} onChange={(v) => set('losses', { nameplatePct: n(v) })} />
            <NumField label="Albedo" unit="" value={l.albedo} disabled={ro} error={err('losses.albedo')} onChange={(v) => set('losses', { albedo: n(v) })} />
            <NumField label="IAM b0" unit="" value={l.iamB0} disabled={ro} error={err('losses.iamB0')} onChange={(v) => set('losses', { iamB0: n(v) })} />
            <label style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 12 }}>Transposition</span><select aria-label="Transposition" disabled={ro} value={l.transposition} onChange={(e) => set('losses', { transposition: e.target.value as 'perez' | 'hay-davies' })}><option value="perez">Perez</option><option value="hay-davies">Hay–Davies</option></select></label>
            <label style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 12 }}>Cell temperature</span><select aria-label="Cell temperature model" disabled={ro} value={l.cellTemp.kind} onChange={(e) => set('losses', { cellTemp: e.target.value === 'noct' ? { kind: 'noct', noctC: 45 } : { kind: 'faiman', u0: 25, u1: 6.84 } })}><option value="faiman">Faiman</option><option value="noct">NOCT</option></select></label>
          </>}
        </div>
        <span style={dim}>Inverter efficiency comes from the inverter’s Euro efficiency; temperature from the cell-temperature model.</span>
      </Section>

      <Section title="Degradation">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <NumField label="Year-1" unit="%" value={cfg.degradation.firstYearPct} disabled={ro} error={err('degradation.firstYearPct')} onChange={(v) => set('degradation', { firstYearPct: n(v) })} />
          <NumField label="Annual" unit="%/yr" value={cfg.degradation.annualPct} disabled={ro} error={err('degradation.annualPct')} onChange={(v) => set('degradation', { annualPct: n(v) })} />
        </div>
      </Section>

      <Section title="Weather">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label><input type="radio" aria-label="PVGIS TMY" checked readOnly disabled={ro} /> PVGIS TMY</label>
          <label><input type="radio" aria-label="Upload measured weather" disabled /> Upload measured weather <span style={dim}>(coming later)</span></label>
        </div>
        {weather
          ? <span>{`PVGIS TMY at ${weather.latRound.toFixed(2)}, ${weather.lngRound.toFixed(2)}${weather.radiationDb ? ` (${weather.radiationDb})` : ''}, fetched ${sastDate(weather.fetchedAt)}${weather.gsaPvoutKwhPerKwp !== null ? ` · GSA ${num(weather.gsaPvoutKwhPerKwp, 0)} kWh/kWp (sanity check after a run)` : ''}`}</span>
          : <span>No weather yet.</span>}
        {err('weather.datasetId') && <span role="alert" style={alert}>{errors['weather.datasetId']}</span>}
        {!ro && <div><Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={fetchWeather}>{busy === 'weather' ? 'Fetching…' : 'Fetch PVGIS weather'}</Button></div>}
      </Section>

      <Section title="Battery">
        <Check label="Battery enabled" checked={b.enabled} disabled={ro} onChange={(v) => set('battery', { enabled: v })} />
        {b.enabled && <>
          <label style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 12 }}>Battery unit</span><select aria-label="Battery unit" disabled={ro} value={b.unit?.equipmentId ?? ''} onChange={(e) => pickBattery(e.target.value)}>
            <option value="">Custom</option>
            {live(equipment.batteries, b.unit?.equipmentId).map((m) => <option key={m.id} value={m.id}>{m.make} {m.model}{m.retired ? ' (retired)' : ''}</option>)}
            {b.unit && !equipment.batteries.some((m) => m.id === b.unit!.equipmentId) && <option value={b.unit.equipmentId}>{b.unit.make} {b.unit.model}</option>}
          </select></label>
          {err('battery.unit') && <span role="alert" style={alert}>{errors['battery.unit']}</span>}
          <div style={grid}>
            <NumField label="Usable capacity" unit="kWh" value={b.usableKwh} disabled={ro} error={err('battery.usableKwh')} onChange={(v) => set('battery', { usableKwh: n(v) })} />
            <NumField label="Max charge" unit="kW" value={b.maxChargeKw} disabled={ro} error={err('battery.maxChargeKw')} onChange={(v) => set('battery', { maxChargeKw: n(v) })} />
            <NumField label="Max discharge" unit="kW" value={b.maxDischargeKw} disabled={ro} error={err('battery.maxDischargeKw')} onChange={(v) => set('battery', { maxDischargeKw: n(v) })} />
            <NumField label="Round-trip efficiency" unit="%" value={b.rtePct} disabled={ro} error={err('battery.rtePct')} onChange={(v) => set('battery', { rtePct: n(v) })} />
            <NumField label="SoC min" unit="%" value={b.socMinPct} disabled={ro} error={err('battery.socMinPct')} onChange={(v) => set('battery', { socMinPct: n(v) })} />
            <NumField label="SoC max" unit="%" value={b.socMaxPct} disabled={ro} error={err('battery.socMaxPct')} onChange={(v) => set('battery', { socMaxPct: n(v) })} />
            <NumField label="Initial SoC" unit="%" value={b.initialSocPct} disabled={ro} error={err('battery.initialSocPct')} onChange={(v) => set('battery', { initialSocPct: n(v) })} />
            <NumField label="Backup reserve" unit="%" value={b.backupReservePct} disabled={ro} error={err('battery.backupReservePct')} onChange={(v) => set('battery', { backupReservePct: n(v) })} />
          </div>
          <label style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 12 }}>Strategy</span><select aria-label="Strategy" disabled={ro} value={b.strategy} onChange={(e) => {
            const s = e.target.value as CaseConfig['battery']['strategy']
            set('battery', { strategy: s, gridCharging: s === 'tou-arbitrage' ? b.gridCharging : false })
          }}><option value="self-consumption">Self-consumption</option><option value="tou-arbitrage">TOU arbitrage</option><option value="peak-shaving">Peak shaving</option></select></label>
          {b.strategy === 'peak-shaving' && <NumField label="Peak-shaving target" unit="kW" value={b.peakTargetKw} disabled={ro} error={err('battery.peakTargetKw')} onChange={(v) => set('battery', { peakTargetKw: v })} />}
          <Check label="Allow grid charging" checked={b.gridCharging} disabled={ro || b.strategy !== 'tou-arbitrage'} onChange={(v) => set('battery', { gridCharging: v })} />
          <span style={dim}>Replacement year and cost are set on Financials.</span>
        </>}
      </Section>

      <Section title="Grid / export">
        <span>{`Inherited: ${data.studyExport.mode ? (EXPORT_MODE[data.studyExport.mode] ?? data.studyExport.mode) : 'not set'}${data.studyExport.limitKw !== null ? `, export limit ${num(data.studyExport.limitKw, 0)} kW` : ''}`}</span>
        <Check label="Override for this case" checked={g.overrideExport} disabled={ro} onChange={(v) => set('grid', v && !g.overrideExport ? { overrideExport: true, ...inheritedExport(data.studyExport) } : { overrideExport: v })} />
        {g.overrideExport && <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <Check label="Export allowed" checked={g.exportAllowed} disabled={ro} onChange={(v) => set('grid', { exportAllowed: v })} />
          <NumField label="Export limit" unit="kW" value={g.exportLimitKw} disabled={ro || !g.exportAllowed} error={err('grid.exportLimitKw')} onChange={(v) => set('grid', { exportLimitKw: v })} />
          {/* Unticked = "Yes (no credit)": the energy still leaves the site, the bill credits none of it. */}
          <Check label="Export earns credit" checked={g.exportCredited} disabled={ro || !g.exportAllowed} onChange={(v) => set('grid', { exportCredited: v })} />
        </div>}
        <NumField label="Inverter AC cap" unit="kW" value={g.inverterAcCapKw} disabled={ro} error={err('grid.inverterAcCapKw')} onChange={(v) => set('grid', { inverterAcCapKw: v })} />
      </Section>

      <Section title="Load">
        <span>{data.siteLoad ? `${data.siteLoad.basis} load, reference year ${data.siteLoad.referenceYear}: ${mwh(data.siteLoad.annualKwh)}/yr, peak ${num(data.siteLoad.peakKw)} kW` : 'No site load yet — build it on the Load tab.'}</span>
        <NumField label="Load adjustment (what-if)" unit="%" value={cfg.load.adjustmentPct} disabled={ro} error={err('load.adjustmentPct')} onChange={(v) => set('load', { adjustmentPct: n(v) })} />
      </Section>

      <Section title="Load-shedding value">
        <Check label="Value load-shedding avoided" checked={cfg.loadShedding.enabled} disabled={ro} onChange={(v) => set('loadShedding', { enabled: v })} />
        {cfg.loadShedding.enabled && <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 12 }}>Stage</span><select aria-label="Load-shedding stage" disabled={ro} value={cfg.loadShedding.stage} onChange={(e) => set('loadShedding', { stage: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 7, 8].map((s) => <option key={s} value={s}>Stage {s}</option>)}</select></label>
          <NumField label="Hours a year avoided" unit="h" value={cfg.loadShedding.hoursPerYear} disabled={ro} error={err('loadShedding.hoursPerYear')} onChange={(v) => set('loadShedding', { hoursPerYear: n(v) })} />
          <NumField label="Backed-up load" unit="kW" value={cfg.loadShedding.backedLoadKw} disabled={ro} error={err('loadShedding.backedLoadKw')} onChange={(v) => set('loadShedding', { backedLoadKw: n(v) })} />
        </div>}
        <span style={dim}>Reported as a separate line, never in the IRR (D-14). The R/kWh value is set on Financials.</span>
      </Section>
    </>
  )
  const unplaced = Object.entries(errors).filter(([k]) => !placed.has(k))

  return (
    <form onSubmit={(e) => e.preventDefault()} style={{ display: 'grid', gap: 12 }} aria-label={`Case ${data.name}`}>
      {form}
      {data.tariffNote && <span style={dim}>{`Tariff: ${data.tariffNote} Energy results do not need it; the TOU split and TOU arbitrage do.`}</span>}
      {blocked && (
        <div>
          <span style={{ fontWeight: 600 }}>Before this case can run:</span>
          <ul aria-label="Before this case can run" style={{ margin: 0 }}>{data.buildReasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      {unplaced.length > 0 && <ul aria-label="Fix these fields" style={{ margin: 0 }}>{unplaced.map(([k, v]) => <li key={k} role="alert" style={alert}>{v}</li>)}</ul>}
      {message && <span role="alert">{message}</span>}

      {!ro && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button type="button" disabled={!dirty || busy !== null} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save case'}</Button>
          <Button type="button" disabled={dirty || blocked || busy !== null || data.running} onClick={run}>{busy === 'run' ? 'Running…' : 'Run'}</Button>
          {running && <Button type="button" variant="secondary" onClick={cancel}>Cancel run</Button>}
          <Button type="button" variant={discard.armed ? 'danger' : 'secondary'} disabled={!dirty}
            onClick={() => {
              if (!discard.armed) { discard.arm(); return }
              discard.disarm(); setCfg(saved); setWeather(data.weather); setErrors({}); setMessage(null)
            }}>
            {discard.armed ? 'Discard all changes?' : 'Discard changes'}
          </Button>
          {dirty && <span style={{ fontSize: 12 }}>Save first — Run uses the saved inputs</span>}
        </div>
      )}
    </form>
  )
}
