import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { createClient } from '@/lib/supabase/server'
import type { AnyClient } from '@/lib/tariffs/admin-gate'
import { loadCompareTariffs, loadLicenseeIndex } from '@/lib/tariffs/explorer-data'
import { CompareClient, type CompareTariffInput } from './CompareClient'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function CompareTariffsPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams
  const ids = [...new Set((t ?? '').split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))].slice(0, 4)
  const supabase = (await createClient()) as unknown as AnyClient
  let selected: CompareTariffInput[]
  let licensees
  try {
    const [rows, index] = await Promise.all([loadCompareTariffs(supabase, ids), loadLicenseeIndex(supabase)])
    selected = rows.map((r) => ({ id: r.id, label: r.label, tariff: r.tariff, highSeasonMonths: r.highSeasonMonths, seasonsAssumed: r.seasonsAssumed }))
    licensees = index.filter((l) => l.liveFy).map(({ mdbCode: _m, hasAnyYear: _h, ...l }) => l)
  } catch {
    return <ErrorState title="Could not load the comparison" description="Reload the page. If it keeps failing, report it to support." />
  }
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Compare tariffs</span><span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>One profile, priced on each tariff for a year</span></CardHeader>
      <CardBody>
        <CompareClient selected={selected} licensees={licensees} year={new Date().getFullYear()} />
      </CardBody>
    </Card>
  )
}
