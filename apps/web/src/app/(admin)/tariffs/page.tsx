import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { createClient } from '@/lib/supabase/server'
import type { AnyClient } from '@/lib/tariffs/admin-gate'
import { loadLicenseeIndex, type LicenseeIndexItem } from '@/lib/tariffs/explorer-data'
import { LicenseeSearch } from './_components/LicenseeSearch'
import { MUTED, Stat, autoGrid } from './_components/explorer-ui'

export const dynamic = 'force-dynamic'

export default async function TariffExplorerPage() {
  const supabase = (await createClient()) as unknown as AnyClient
  let index: LicenseeIndexItem[]
  try {
    index = await loadLicenseeIndex(supabase)
  } catch {
    return <ErrorState title="Could not load the tariff library" description="Reload the page. If it keeps failing, report it to support." />
  }
  const liveList = index.filter((l) => l.liveFy)
  const live = liveList.length
  const provinces = new Set(liveList.map((l) => l.province).filter((p) => p && p !== 'national')).size
  const latest = liveList.reduce<string | null>((m, l) => (m === null || (l.liveFy ?? '') > m ? l.liveFy : m), null)
  const onLatest = latest ? liveList.filter((l) => l.liveFy === latest).length : 0
  return (
    <Card>
      <CardHeader>
        <span className="data-panel-title">Find a supply authority</span>
        <span style={{ fontSize: 12, ...MUTED }}>{live} of {index.length} have published tariffs</span>
      </CardHeader>
      <CardBody>
        {index.length === 0
          ? <p style={{ fontSize: 13, margin: 0 }}>The tariff library is open to members of an active organisation. Ask your organisation&apos;s owner to reactivate your membership.</p>
          : (
            <div style={{ display: 'grid', gap: 20 }}>
              <div style={autoGrid(140, 10)} aria-label="Library coverage" role="group">
                <Stat label="Published" value={live} sub={`supply authorities of ${index.length}`} />
                <Stat label="Provinces" value={provinces} sub="with published municipal tariffs" />
                {latest && <Stat label="Latest year" value={latest} sub={`${onLatest} authorit${onLatest === 1 ? 'y' : 'ies'} on it`} />}
              </div>
              <LicenseeSearch browse licensees={index.map(({ mdbCode: _m, hasAnyYear: _h, ...l }) => l)} />
            </div>
          )}
        <p style={{ fontSize: 12, ...MUTED, marginTop: 16, marginBottom: 0 }}>
          Values are the NERSA-approved tariffs as published by each licensee, excluding VAT unless marked otherwise. Years still under review are not shown.
        </p>
      </CardBody>
    </Card>
  )
}
