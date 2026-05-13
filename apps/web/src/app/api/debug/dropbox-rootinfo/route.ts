/**
 * TEMPORARY debug route at /api/debug/dropbox-rootinfo — surfaces what
 * /users/get_current_account returns for the caller's most recent Dropbox
 * connection. Used to diagnose whether the team-namespace fix in
 * dropbox.provider.ts is being applied.
 *
 * Originally lived under /api/__debug/... but Next.js App Router treats
 * path segments starting with `_` as PRIVATE FOLDERS (skipped from routing)
 * — that's why the prior URL returned 404 even though the file was in
 * the build. Single-segment plain `debug` is the fix.
 *
 * DELETE THIS ROUTE once the picker is confirmed working.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decryptToken } from '@esite/db'

function hexToUint8(hex: string): Uint8Array {
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { data: memRaw } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()
  const mem = memRaw as { organisation_id: string } | null
  if (!mem) return NextResponse.json({ error: 'no org' }, { status: 400 })

  const { data: connsRaw, error } = await (supabase as any)
    .from('org_storage_connections')
    .select('id, provider, account_email, access_token_enc, expires_at, created_at')
    .eq('organisation_id', mem.organisation_id)
    .eq('provider', 'dropbox')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return NextResponse.json({ error: 'connection lookup', detail: error.message }, { status: 500 })
  const conn = (connsRaw ?? [])[0] as
    | { id: string; account_email: string; access_token_enc: string; expires_at: string | null; created_at: string }
    | undefined
  if (!conn) return NextResponse.json({ error: 'no dropbox connection' }, { status: 404 })

  let accessToken: string
  try {
    accessToken = await decryptToken(hexToUint8(conn.access_token_enc))
  } catch (e) {
    return NextResponse.json({ error: 'decrypt failed', detail: String(e) }, { status: 500 })
  }

  let raw: unknown = null
  try {
    const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    raw = res.ok ? await res.json() : { _error: `HTTP ${res.status}`, _body: (await res.text()).slice(0, 500) }
  } catch (e) {
    raw = { _error: 'fetch threw', _detail: String(e) }
  }

  // Also try a list_folder("") with the namespace header so we see what would actually come back.
  // Predicate matches dropbox.provider.ts deriveRootNamespaceId(): namespace-id divergence.
  const r = raw as { root_info?: { '.tag'?: string; root_namespace_id?: string; home_namespace_id?: string }; team?: unknown }
  const ri = r?.root_info
  const needsPathRoot = !!(ri && ri.root_namespace_id && ri.root_namespace_id !== ri.home_namespace_id)
  const headerWouldBe = needsPathRoot
    ? { 'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: ri!.root_namespace_id! }) }
    : null
  const isTeam = needsPathRoot // alias kept for backwards-compatibility with existing reports

  let listResultWithHeader: unknown = 'skipped (root_namespace_id == home_namespace_id — no path-root header needed)'
  let listResultWithoutHeader: unknown = null
  if (needsPathRoot && headerWouldBe) {
    try {
      const r2 = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...headerWouldBe },
        body: JSON.stringify({ path: '', recursive: false, include_non_downloadable_files: false }),
      })
      const j = r2.ok ? await r2.json() : { _error: `HTTP ${r2.status}`, _body: (await r2.text()).slice(0, 500) }
      listResultWithHeader = (j as { entries?: Array<{ name: string; '.tag': string }> }).entries
        ? (j as { entries: Array<{ name: string; '.tag': string }> }).entries.map((e) => `${e['.tag']}: ${e.name}`)
        : j
    } catch (e) {
      listResultWithHeader = { _error: 'fetch threw', _detail: String(e) }
    }
  }
  // Also call list_folder WITHOUT the header to see what the picker sees
  try {
    const r3 = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '', recursive: false, include_non_downloadable_files: false }),
    })
    const j = r3.ok ? await r3.json() : { _error: `HTTP ${r3.status}`, _body: (await r3.text()).slice(0, 500) }
    listResultWithoutHeader = (j as { entries?: Array<{ name: string; '.tag': string }> }).entries
      ? (j as { entries: Array<{ name: string; '.tag': string }> }).entries.map((e) => `${e['.tag']}: ${e.name}`)
      : j
  } catch (e) {
    listResultWithoutHeader = { _error: 'fetch threw', _detail: String(e) }
  }

  return NextResponse.json(
    {
      connection: { id: conn.id, account_email: conn.account_email, created_at: conn.created_at },
      dropbox_get_current_account_response: raw,
      derived: {
        needsPathRootHeader: needsPathRoot,
        isTeamAccount: isTeam, // legacy alias
        root_namespace_id: r?.root_info?.root_namespace_id ?? null,
        home_namespace_id: r?.root_info?.home_namespace_id ?? null,
        namespace_ids_diverge: ri ? ri.root_namespace_id !== ri.home_namespace_id : null,
        team_object_present: !!r?.team,
        headerThatProviderWouldSend: headerWouldBe,
      },
      listFolderRoot_WITH_namespaceHeader: listResultWithHeader,
      listFolderRoot_WITHOUT_namespaceHeader: listResultWithoutHeader,
    },
    { status: 200 },
  )
}
