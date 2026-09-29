import { randPerKwh, unitClass } from './units'
import { normaliseTariffName, type TariffIssue } from './validators'
import type { Charge, ChargeComponent, Tariff, TariffUnit } from './types'

export interface YoyChange {
  key: string
  tariff: string
  component: ChargeComponent
  prev: number
  next: number
  unit: TariffUnit
  /** Percent, 3 dp; null when the previous value was zero or the unit changed. */
  changePct: number | null
}

export interface YoyDiff {
  added: string[]
  removed: string[]
  changed: YoyChange[]
  unchanged: number
  issues: TariffIssue[]
}

export function chargeKey(t: Tariff, c: Charge): string {
  return [normaliseTariffName(t.name), c.component, c.season, c.tou, c.blockMinKwh ?? '-'].join('|')
}

function comparable(c: Charge): { value: number; unit: TariffUnit } {
  return unitClass(c.unit) === 'per_kwh' ? { value: randPerKwh(c), unit: 'R_per_kWh' } : { value: c.amountExclVat, unit: c.unit }
}

export function diffTariffYears(
  prev: readonly Tariff[], next: readonly Tariff[], approvedIncreasePct: number | null, tolerancePp = 3,
): YoyDiff {
  const index = (ts: readonly Tariff[]): Map<string, { t: Tariff; c: Charge }> => {
    const m = new Map<string, { t: Tariff; c: Charge }>()
    for (const t of ts) for (const c of t.charges) m.set(chargeKey(t, c), { t, c })
    return m
  }
  const a = index(prev)
  const b = index(next)
  const res: YoyDiff = { added: [], removed: [], changed: [], unchanged: 0, issues: [] }

  for (const [key, { t, c }] of b) {
    const old = a.get(key)
    if (!old) {
      res.added.push(key)
      continue
    }
    const p = comparable(old.c)
    const n = comparable(c)
    if (p.unit !== n.unit) {
      res.changed.push({ key, tariff: t.name, component: c.component, prev: p.value, next: n.value, unit: n.unit, changePct: null })
      res.issues.push({ code: 'yoy_unit_changed', severity: 'review', message: `${key}: unit changed ${p.unit} -> ${n.unit}`, tariff: t.name, locator: c.sourceLocator })
      continue
    }
    if (p.value === n.value) {
      res.unchanged++
      continue
    }
    const changePct = p.value === 0 ? null : Math.round((n.value / p.value - 1) * 100 * 1000) / 1000
    res.changed.push({ key, tariff: t.name, component: c.component, prev: p.value, next: n.value, unit: n.unit, changePct })
    if (approvedIncreasePct !== null && changePct !== null && Math.abs(changePct - approvedIncreasePct) > tolerancePp) {
      res.issues.push({
        code: 'yoy_out_of_band', severity: 'review',
        message: `${t.name} ${c.component}: ${changePct}% against an approved ${approvedIncreasePct}% (+-${tolerancePp}pp)`,
        tariff: t.name, locator: c.sourceLocator,
      })
    }
  }
  for (const key of a.keys()) if (!b.has(key)) res.removed.push(key)
  return res
}
