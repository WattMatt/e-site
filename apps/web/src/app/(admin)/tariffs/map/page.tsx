import { notFound } from 'next/navigation'
import { SUPPLY_STATUS_LABELS, supplyByCode, type AreaSupply, type SupplyStatus } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { createClient } from '@/lib/supabase/server'
import type { AnyClient } from '@/lib/tariffs/admin-gate'
import { loadLicenseeIndex, mapLicensees } from '@/lib/tariffs/explorer-data'
import { tariffMapEnabled } from '@/lib/tariffs/map-flag'
import boundaries from '@/lib/tariffs/geo/za-local-municipalities-2021.json'
import { SupplyMap } from './SupplyMap'

export const dynamic = 'force-dynamic'

export default async function SupplyMapPage() {
  if (!tariffMapEnabled()) notFound()
  const supabase = (await createClient()) as unknown as AnyClient
  let supply: Record<string, AreaSupply>
  try {
    supply = Object.fromEntries(supplyByCode(mapLicensees(await loadLicenseeIndex(supabase))))
  } catch {
    return <ErrorState title="Could not load the map" description="Reload the page. If it keeps failing, report it to support." />
  }
  const counts = { published: 0, in_review: 0, no_tariffs: 0, no_licensee: 0 } as Record<SupplyStatus, number>
  for (const f of (boundaries as { features: Array<{ properties: { code: string } }> }).features) counts[supply[f.properties.code.toUpperCase()]?.status ?? 'no_licensee']++
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Area of supply</span><span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>213 local and metropolitan municipalities</span></CardHeader>
      <CardBody>
        <SupplyMap supply={supply} />
        <table style={{ fontSize: 12, borderCollapse: 'collapse', marginTop: 12 }}>
          <caption style={{ textAlign: 'left', fontWeight: 600, marginBottom: 4 }}>Municipalities by status</caption>
          <tbody>{(Object.keys(counts) as SupplyStatus[]).map((s) => (
            <tr key={s}><td style={{ paddingRight: 12 }}>{SUPPLY_STATUS_LABELS[s]}</td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{counts[s]}</td></tr>
          ))}</tbody>
        </table>
      </CardBody>
    </Card>
  )
}
