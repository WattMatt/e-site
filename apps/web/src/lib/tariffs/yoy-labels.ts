/** diffTariffYears keys ("name|component|season|tou|block") -> what an admin reads. */
import { COMPONENT_LABELS, SEASON_LABELS, TOU_LABELS, chargeKey, type Tariff } from '@esite/shared'

export function describeChargeKeys(tariffs: readonly Tariff[], keys: readonly string[]): string[] {
  const byKey = new Map<string, string>()
  for (const t of tariffs) {
    for (const c of t.charges) {
      const narrow = [
        c.season !== 'all' ? SEASON_LABELS[c.season] : null,
        c.tou !== 'all' ? TOU_LABELS[c.tou] : null,
        c.blockMinKwh !== null && c.blockMinKwh !== undefined && c.blockMinKwh > 0 ? `from ${c.blockMinKwh} kWh` : null,
      ].filter(Boolean)
      byKey.set(chargeKey(t, c), `${t.name} — ${COMPONENT_LABELS[c.component]}${narrow.length ? ` (${narrow.join(', ')})` : ''}`)
    }
  }
  return keys.map((k) => byKey.get(k) ?? 'Unknown charge')
}
