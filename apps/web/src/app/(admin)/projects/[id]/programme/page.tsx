/**
 * The programme screen (P3). Dark behind PROGRAMME_ENABLED. Reads: every project role except
 * client_viewer. Edits: ORG_WRITE_ROLES, or Solar Edit for a solar module programme; the server
 * actions remain the real gate. Everything handed to the client component is JSON.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { sastToday, solarLevelAllows } from '@esite/shared'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { getSolarAccessLevel } from '@/lib/solar/access'
import { programmeEnabled } from '@/lib/programme/flag'
import { PROGRAMME_READ_ROLES, PROGRAMME_WRITE_ROLES } from '@/lib/programme/access'
import { loadProgrammeView } from '@/lib/programme/view-data'
import { ProgrammeClient } from './ProgrammeClient'
import { CreateProgrammeForm } from './CreateProgrammeForm'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

const card = (title: string, body: string, alert = false) => (
  <div className="page">
    <div className="page-header"><h1 className="page-title">{title}</h1></div>
    <div className="card empty-state"><p role={alert ? 'alert' : undefined}>{body}</p></div>
  </div>
)

/** The project's start date, else today in SAST (the form's default). */
async function defaultStart(supabase: AnyClient, projectId: string): Promise<string> {
  const { data } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .schema('projects').from('projects').select('start_date').eq('id', projectId).maybeSingle()
  const d = (data as { start_date?: string | null } | null)?.start_date
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : String(sastToday())
}

export default async function ProgrammePage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ programme?: string; module?: string }>
}) {
  if (!programmeEnabled()) return card('Project Programme', 'The programme module is not switched on yet.')

  const id = (await params).id.toLowerCase()
  const sp = await searchParams
  const supabase = (await createClient()) as unknown as AnyClient
  const gate = await requireEffectiveRole(supabase, id, PROGRAMME_READ_ROLES)
  if (!gate.ok) return card('Project Programme', "You do not have access to this project's programme.")

  const programmeId = sp.programme ? sp.programme.toLowerCase() : undefined
  const module = sp.module === 'solar' ? ('solar' as const) : undefined
  const loaded = await loadProgrammeView(supabase, id, { programmeId, module })
  if (!loaded.ok) return card('Project Programme', loaded.error, true)

  const roleCanEdit = PROGRAMME_WRITE_ROLES.includes(gate.role)
  if (!loaded.view) {
    // Module programmes are created elsewhere (P9): never offer the project form for them.
    if (module === 'solar') return card('Programme', 'No Solar programme yet.')
    if (!roleCanEdit) return card('Project Programme', 'No programme yet.')
    return <CreateProgrammeForm projectId={id} defaultStart={await defaultStart(supabase, id)} />
  }

  const canEdit = loaded.view.state.programme.kind === 'module'
    ? solarLevelAllows(await getSolarAccessLevel(id, supabase), 'edit')
    : roleCanEdit
  // Keys the grid's remembered column choice; null keeps it per browser.
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth?.user?.id ?? null
  // Keyed by programme: the switcher pushes ?programme= on the same route segment, and without a
  // key React would keep the old client and its store (still showing and saving the old programme).
  return <ProgrammeClient key={loaded.view.state.programme.id} projectId={id} view={loaded.view} canEdit={canEdit} programmes={loaded.programmes} userId={userId} />
}
