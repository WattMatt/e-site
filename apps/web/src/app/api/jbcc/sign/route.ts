import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/jbcc/sign?path=<storagePath>
 *
 * Issues a 5-minute signed URL for a file in the private `jbcc-letters`
 * bucket.  Path format: `{orgId}/projects/{projectId}/letters/{letterId}.docx`
 *
 * Security:
 *   1. Requires an authenticated user session.
 *   2. Validates that the leading org-id segment belongs to one of the
 *      user's organisations via `public.get_user_org_ids()` — same function
 *      the storage RLS policy uses, so the check is consistent.
 *
 * Scope (intentional): authorisation is **org-level**, not project-level. A
 * member of org A can request a signed URL for any letter file in org A's
 * folder regardless of which project inside the org the file belongs to.
 * This matches the broader esite convention (org membership is the
 * authorisation boundary) and the inspections module's equivalent endpoint.
 * If a future feature needs project-level isolation, add a project-membership
 * lookup here before generating the signed URL.
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

  // Validate that the first path segment (the org id) is one the caller
  // belongs to.  This prevents one user from requesting signed URLs for
  // another org's letters by guessing paths.
  const firstSegment = path.split('/')[0] ?? ''
  const { data: orgIds, error: orgErr } = await supabase.rpc('get_user_org_ids')
  if (orgErr) {
    return NextResponse.json({ error: 'Could not verify org membership' }, { status: 500 })
  }
  const allowedIds: string[] = (orgIds ?? []) as string[]
  if (!allowedIds.includes(firstSegment)) {
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
