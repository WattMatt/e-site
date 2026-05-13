/**
 * TEMPORARY debug route — surfaces what /users/get_current_account returns
 * for the caller's most recent Dropbox connection. Used to diagnose whether
 * the team-namespace fix in dropbox.provider.ts is being applied.
 *
 * DELETE ONCE the picker is confirmed working.
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

  // Also try a list_folder("") with the namespace header so we see what would actually come back
  const r = raw as { root_info?: { '.tag'?: string; root_namespace_id?: string; home_namespace_id?: string } }
  const isTeam = r?.root_info?.['.tag'] === 'team'
  const headerWouldBe = isTeam
    ? { 'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: r.root_info!.root_namespace_id! }) }
    : null

  let listResultWithHeader: unknown = 'skipped (not a team account)'
  let listResultWithoutHeader: unknown = null
  if (isTeam && headerWouldBe) {
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
        isTeamAccount: isTeam,
        root_namespace_id: r?.root_info?.root_namespace_id ?? null,
        home_namespace_id: r?.root_info?.home_namespace_id ?? null,
        headerThatProviderWouldSend: headerWouldBe,
      },
      listFolderRoot_WITH_namespaceHeader: listResultWithHeader,
      listFolderRoot_WITHOUT_namespaceHeader: listResultWithoutHeader,
    },
    { status: 200 },
  )
}
