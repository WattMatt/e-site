import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { createClient } from '@/lib/supabase/server'
import type { AnyClient } from '@/lib/tariffs/admin-gate'
import { loadLicenseeIndex, type LicenseeIndexItem } from '@/lib/tariffs/explorer-data'
import { LicenseeSearch } from './_components/LicenseeSearch'

export const dynamic = 'force-dynamic'

export default async function TariffExplorerPage() {
  const supabase = (await createClient()) as unknown as AnyClient
  let index: LicenseeIndexItem[]
  try {
    index = await loadLicenseeIndex(supabase)
  } catch {
    return <ErrorState title="Could not load the tariff library" description="Reload the page. If it keeps failing, report it to support." />
  }
  const live = index.filter((l) => l.liveFy).length
  return (
    <Card>
      <CardHeader>
        <span className="data-panel-title">Find a supply authority</span>
        <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>{live} of {index.length} have published tariffs</span>
      </CardHeader>
      <CardBody>
        {index.length === 0
          ? <p style={{ fontSize: 13, margin: 0 }}>The tariff library is open to members of an active organisation. Ask your organisation&apos;s owner to reactivate your membership.</p>
          : <LicenseeSearch licensees={index.map(({ mdbCode: _m, hasAnyYear: _h, ...l }) => l)} />}
        <p style={{ fontSize: 12, color: 'var(--c-text-mid)', marginTop: 12, marginBottom: 0 }}>
          Values are the NERSA-approved tariffs as published by each licensee, excluding VAT unless marked otherwise. Years still under review are not shown.
        </p>
      </CardBody>
    </Card>
  )
}
