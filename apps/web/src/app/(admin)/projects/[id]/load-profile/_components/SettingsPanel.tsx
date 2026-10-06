'use client'
/** Reference year, power factor, NMD and the tariff (published NERSA-approved years only). */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { listPublishedLicenseesAction, listPublishedTariffsAction, saveLoadProfileSettingsAction } from '@/actions/load-profile.actions'
import type { PublishedLicensee, PublishedTariffOption } from '@/lib/load-profile/tariff-source'
import type { LoadProfileView } from '@/lib/load-profile/view-types'

export function SettingsPanel({ view }: { view: LoadProfileView }) {
  const router = useRouter()
  const s = view.settings
  const [year, setYear] = useState(String(s.referenceYear))
  const [pf, setPf] = useState(String(s.powerFactor))
  const [nmd, setNmd] = useState(s.nmdKva == null ? '' : String(s.nmdKva))
  const [tariffId, setTariffId] = useState<string | null>(s.tariffId)
  const [licensees, setLicensees] = useState<PublishedLicensee[] | null>(null)
  const [query, setQuery] = useState('')
  const [licensee, setLicensee] = useState<string>('')
  const [tariffs, setTariffs] = useState<PublishedTariffOption[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ro = !view.canEdit

  async function openPicker() {
    if (licensees) return
    const r = await listPublishedLicenseesAction(view.projectId)
    if ('error' in r) setError(r.error)
    else setLicensees(r.licensees)
  }
  async function chooseLicensee(id: string) {
    setLicensee(id)
    setTariffs([])
    if (!id) return
    const r = await listPublishedTariffsAction(view.projectId, id)
    if ('error' in r) setError(r.error)
    else setTariffs(r.tariffs)
  }
  async function save(next: { tariffId?: string | null } = {}) {
    setBusy(true)
    setError(null)
    const r = await saveLoadProfileSettingsAction(view.projectId, {
      referenceYear: Number(year), powerFactor: Number(pf), nmdKva: nmd.trim() === '' ? null : Number(nmd),
      tariffId: next.tariffId !== undefined ? next.tariffId : tariffId,
    })
    setBusy(false)
    if ('error' in r) setError(r.error)
    else router.refresh()
  }

  const q = query.trim().toLowerCase()
  const shown = (licensees ?? []).filter((l) => !q || l.name.toLowerCase().includes(q) || l.aliases.some((a) => a.toLowerCase().includes(q))).slice(0, 50)

  return (
    <div className="card" style={{ padding: 16, marginTop: 16, fontSize: 13 }}>
      <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Settings and tariff</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>Reference year <input aria-label="Reference year" type="number" min={2000} max={2100} value={year} disabled={ro} onChange={(e) => setYear(e.target.value)} style={{ width: 80 }} /></label>
        <label>Power factor <input aria-label="Power factor" type="number" min={0.5} max={1} step={0.01} value={pf} disabled={ro} onChange={(e) => setPf(e.target.value)} style={{ width: 70 }} /></label>
        <label>NMD kVA <input aria-label="NMD kVA" type="number" min={1} placeholder={view.analysis ? `${view.analysis.nmd.kva} (suggested)` : ''} value={nmd} disabled={ro} onChange={(e) => setNmd(e.target.value)} style={{ width: 130 }} /></label>
        {!ro && <button className="btn" disabled={busy} onClick={() => void save()}>Save settings</button>}
      </div>

      <div style={{ marginTop: 12 }}>
        <div>
          Tariff: <strong>{view.cost?.ok ? view.cost.label : tariffId ? 'not available' : 'none chosen'}</strong>
          {!ro && tariffId && <button className="btn btn-sm" style={{ marginLeft: 8 }} disabled={busy} onClick={() => { setTariffId(null); void save({ tariffId: null }) }}>Clear</button>}
        </div>
        {!ro && (
          <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) void openPicker() }} style={{ marginTop: 6 }}>
            <summary style={{ cursor: 'pointer' }}>Choose a tariff</summary>
            {licensees === null ? <p>Loading suppliers…</p> : licensees.length === 0 ? <p>No tariffs are available to your organisation yet.</p> : (
              <div style={{ display: 'grid', gap: 6, marginTop: 6, maxWidth: 640 }}>
                <input aria-label="Search supplier" placeholder="Search a municipality or Eskom (name or alias)" value={query} onChange={(e) => setQuery(e.target.value)} />
                <select aria-label="Supplier" size={6} value={licensee} onChange={(e) => void chooseLicensee(e.target.value)}>
                  {shown.map((l) => <option key={l.id} value={l.id}>{l.name}{l.province ? ` (${l.province})` : ''}</option>)}
                </select>
                {tariffs.length > 0 && (
                  <select aria-label="Tariff" size={8} value={tariffId ?? ''} onChange={(e) => { setTariffId(e.target.value); void save({ tariffId: e.target.value }) }}>
                    {tariffs.map((t) => <option key={t.id} value={t.id}>{t.financialYear} · {t.name}{t.code ? ` (${t.code})` : ''} · {t.structure}</option>)}
                  </select>
                )}
                <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Only NERSA-approved, published tariff years are listed.</span>
              </div>
            )}
          </details>
        )}
      </div>
      {error && <p role="alert" style={{ color: 'var(--c-red)', margin: '8px 0 0' }}>{error}</p>}
    </div>
  )
}
