import 'server-only'
/**
 * A tariff year's tariffs and charges as the canonical Tariff model (2a's
 * tariffFromRows), with the row ids kept alongside so an issue's chargeIndex
 * can be mapped back to a charge row. Charges are ordered deterministically
 * BEFORE conversion so tariff.charges[i] is chargeRows[i].
 */
import { tariffFromRows } from '@esite/shared/tariffs/ingest'
import type { Tariff } from '@esite/shared'
import type { AnyClient } from './admin-gate'

type Row = Record<string, unknown>

export interface LoadedTariff {
  id: string
  row: Row
  tariff: Tariff
  chargeRows: Row[]
}

const CHUNK = 100

function chargeOrder(a: Row, b: Row): number {
  const k = (r: Row) => [r.component, r.season, r.tou, r.day_type, String(r.block_min_kwh ?? ''), r.id].join('|')
  return k(a).localeCompare(k(b))
}

export async function loadYearTariffs(client: AnyClient, yearId: string): Promise<LoadedTariff[]> {
  const t = client.schema('tariffs')
  const { data: tariffs, error } = await t.from('tariff').select('*').eq('tariff_year_id', yearId).order('name')
  if (error) throw new Error(`tariffs: ${error.message}`)
  const rows = (tariffs ?? []) as Row[]
  const ids = rows.map((r) => String(r.id))
  const charges: Row[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error: e } = await t.from('charge').select('*').in('tariff_id', ids.slice(i, i + CHUNK))
    if (e) throw new Error(`charges: ${e.message}`)
    charges.push(...((data ?? []) as Row[]))
  }
  return rows.map((r) => {
    const own = charges.filter((c) => c.tariff_id === r.id).sort(chargeOrder)
    return { id: String(r.id), row: r, tariff: tariffFromRows(r, own), chargeRows: own }
  })
}

/** The licensee's published/superseded year immediately before `financialYear`, or null. */
export async function loadPreviousPublished(
  client: AnyClient, licenseeId: string, previousFy: string,
): Promise<{ yearId: string; tariffs: Tariff[] } | null> {
  const { data } = await client.schema('tariffs').from('tariff_year').select('id, state')
    .eq('licensee_id', licenseeId).eq('financial_year', previousFy).in('state', ['published', 'superseded']).limit(1)
  const y = (data as Row[] | null)?.[0]
  if (!y) return null
  const loaded = await loadYearTariffs(client, String(y.id))
  return { yearId: String(y.id), tariffs: loaded.map((l) => l.tariff) }
}
