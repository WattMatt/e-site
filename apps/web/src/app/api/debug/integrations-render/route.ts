/**
 * TEMPORARY debug endpoint — runs the same code path as /settings/integrations
 * server render and returns ANY error verbatim as JSON. Lets us diagnose
 * crashes without relying on browser dev tools.
 *
 * DELETE once integrations page is verified working.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ALL_PROVIDERS, getCloudStorageProvider } from '@esite/shared'

export async function GET() {
  const trace: Record<string, unknown> = {}
  try {
    trace.step1_createClient = 'starting'
    const supabase = await createClient()
    trace.step1_createClient = 'ok'

    trace.step2_getUser = 'starting'
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    trace.step2_getUser = userErr ? `err: ${userErr.message}` : `user: ${user?.id ?? 'null'}`

    if (!user) {
      return NextResponse.json({ ok: true, redirected: '/login', trace })
    }

    trace.step3_membership = 'starting'
    const { data: mem, error: memErr } = await supabase
      .from('user_organisations')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .single()
    trace.step3_membership = memErr ? `err: ${memErr.message}` : `role: ${(mem as { role?: string } | null)?.role ?? 'null'}`

    trace.step4_select_connections = 'starting'
    const { data, error } = await (supabase as any)
      .from('org_storage_connections')
      .select('id, provider, account_email, scope, expires_at, created_at, team_id, team_name')
      .order('created_at', { ascending: false })
    trace.step4_select_connections = error
      ? { err: error.message, code: error.code, details: error.details, hint: error.hint }
      : { rows: Array.isArray(data) ? data.length : 'not-array', sample: Array.isArray(data) && data[0] ? data[0] : null }

    trace.step5_provider_resolution = 'starting'
    const providerResults: Record<string, string> = {}
    for (const p of ALL_PROVIDERS) {
      try {
        const provider = getCloudStorageProvider(p as 'dropbox' | 'google_drive' | 'onedrive' | 'dropbox_team')
        providerResults[p] = `ok: ${provider.name}`
      } catch (e) {
        providerResults[p] = `err: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    trace.step5_provider_resolution = providerResults

    return NextResponse.json({ ok: true, trace })
  } catch (e) {
    return NextResponse.json({
      ok: false,
      threw: e instanceof Error ? {
        name: e.name,
        message: e.message,
        stack: e.stack?.split('\n').slice(0, 10),
      } : String(e),
      trace,
    }, { status: 500 })
  }
}
