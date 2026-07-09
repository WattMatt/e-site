import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { JBCC_WRITE_ROLES } from '@esite/shared'

/**
 * GET /api/jbcc/sign?path=<storagePath>
 *
 * Issues a 5-minute signed URL for a file in the private `jbcc-letters`
 * bucket.  Path format: `{orgId}/projects/{projectId}/letters/{letterId}.docx`
 * (attachments: `{orgId}/projects/{projectId}/letters/{letterId}/attachments/{file}`).
 *
 * Security — authorisation is **project-level** (mirrors the JBCC RLS
 * tightening, migration 00170). Org membership alone is no longer sufficient
 * to mint a signed URL for another project's letters:
 *   1. Requires an authenticated user session.
 *   2. Validates the storage-path shape (`{orgId}/projects/{projectId}/…`);
 *      malformed input → 400.
 *   3. Defence-in-depth: the leading org-id segment must belong to one of the
 *      caller's organisations via `public.get_user_org_ids()` — the same
 *      function the storage RLS policy uses, so the checks stay consistent.
 *   4. Project scope: the caller must hold a JBCC write role
 *      (owner/admin/project_manager/contractor) on the *specific* project the
 *      file belongs to, via `public.user_effective_project_role`.
 */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path')
  if (!path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  }

  const supabase = await createClient()

  // Require authenticated user.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  // Validate the storage-path shape: {orgId}/projects/{projectId}/letters/…
  const segments = path.split('/')
  const orgSegment = segments[0] ?? ''
  const projectId  = segments[2] ?? ''
  if (!orgSegment || segments[1] !== 'projects' || !projectId || segments[3] !== 'letters') {
    return NextResponse.json({ error: 'Malformed path' }, { status: 400 })
  }

  // Defence-in-depth: the leading org-id segment must be one the caller
  // belongs to.  This prevents one user from requesting signed URLs for
  // another org's letters by guessing paths.
  const { data: orgIds, error: orgErr } = await supabase.rpc('get_user_org_ids')
  if (orgErr) {
    return NextResponse.json({ error: 'Could not verify org membership' }, { status: 500 })
  }
  const allowedIds: string[] = (orgIds ?? []) as string[]
  if (!allowedIds.includes(orgSegment)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Project-level authorisation: the caller must hold a JBCC write role on the
  // project this file belongs to (mirrors migration 00170 RLS).
  const roleGate = await requireEffectiveRole(supabase, projectId, JBCC_WRITE_ROLES)
  if (!roleGate.ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Issue a short-lived signed URL (5 minutes — enough to open the download).
  const { data, error } = await supabase
    .storage
    .from('jbcc-letters')
    .createSignedUrl(path, 60 * 5)

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Sign failed' }, { status: 500 })
  }

  return NextResponse.json({ url: data.signedUrl })
}
