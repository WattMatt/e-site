/**
 * Load profile (E8): meter imports and tenant-schedule synthesis → profile, peaks, energy, NMD and
 * TOU cost. Project-level and NOT Solar-gated (owner decision E8-D1). Everything is computed here on
 * the server; the client components only draw it.
 */
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { LOAD_PROFILE_READ_ROLES, LOAD_PROFILE_WRITE_ROLES } from '@/lib/load-profile/access'
import { loadLoadProfileView, type AnyClient } from '@/lib/load-profile/load'
import { LoadProfileClient } from './_components/LoadProfileClient'

export const dynamic = 'force-dynamic'
/** Parsing a large meter export in a server action runs inside this page's function. */
export const maxDuration = 60

const ARCHETYPES = [
  { code: 'retail', name: 'Retail (09:00-18:00 Mon-Sat)' },
  { code: 'fast_food', name: 'Fast food (07:00-22:00 daily)' },
  { code: 'restaurant', name: 'Restaurant (11:00-22:00 daily)' },
  { code: 'supermarket', name: 'Supermarket (refrigeration base 35 %)' },
  { code: 'office_bank', name: 'Office / bank (07:00-18:00 Mon-Fri)' },
  { code: 'gym', name: 'Gym (05:00-21:00 daily)' },
  { code: 'anchor_24h', name: 'Anchor (24 h base 60 %)' },
]

export default async function LoadProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id.toLowerCase()
  const supabase = (await createClient()) as unknown as AnyClient
  const gate = await requireEffectiveRole(supabase, id, LOAD_PROFILE_READ_ROLES)
  if (!gate.ok) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Load profile</h1></div>
        <div className="card empty-state"><p>You do not have access to this project&apos;s load profile.</p></div>
      </div>
    )
  }
  const canEdit = LOAD_PROFILE_WRITE_ROLES.includes(gate.role)
  const view = await loadLoadProfileView(supabase, id, { canEdit })
  return <LoadProfileClient view={view} archetypes={ARCHETYPES} />
}
