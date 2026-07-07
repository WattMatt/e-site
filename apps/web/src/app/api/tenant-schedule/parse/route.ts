/**
 * POST /api/tenant-schedule/parse
 *
 * Accepts a multipart upload of a tenant schedule .xlsx file + projectId,
 * parses it via parseTenantSchedule, diffs against the project's existing
 * tenant_db nodes, and returns an ImportPreview.
 *
 * No DB writes — preview only.  The commit step is a separate route.
 *
 * Auth: createClient picks up the user session from cookies.
 * Project access is verified via an RLS-gated projects.projects read, then the
 * caller's EFFECTIVE project role must be in ORG_WRITE_ROLES — the same gate
 * the tenant-schedule page uses to show/hide the ImportFlow control, so the
 * server never accepts a request from a role the UI hides the control from.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  parseTenantSchedule,
  listNodes,
  diffTenantSchedule,
  ORG_WRITE_ROLES,
} from '@esite/shared';
import type { ImportPreview } from '@esite/shared';
import { requireEffectiveRole } from '@/lib/auth/require-role';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — matches project-documents bucket cap

export async function POST(req: Request): Promise<NextResponse<ImportPreview | { error: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // ------------------------------------------------------------------
  // 1. Parse multipart form
  // ------------------------------------------------------------------
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: 'Expected multipart form' }, { status: 400 });
  }

  const projectId = form.get('projectId');
  if (!projectId || typeof projectId !== 'string') {
    return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
  }

  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB (max 50 MB)` },
      { status: 413 },
    );
  }

  // ------------------------------------------------------------------
  // 2. Verify project access (RLS-gated — rejects if user not in org)
  // ------------------------------------------------------------------
  const { data: project, error: projErr } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('id, organisation_id, name')
    .eq('id', projectId)
    .single();

  if (projErr || !project) {
    return NextResponse.json({ error: 'Project not accessible' }, { status: 403 });
  }

  // ------------------------------------------------------------------
  // 2b. Role gate — importing is a schedule WRITE (the commit leg), so the
  //     preview leg is held to the same bar as the page's ImportFlow control:
  //     effective role (org owner/admin/PM, or a per-project promotion via
  //     projects.project_members) must be in ORG_WRITE_ROLES.
  // ------------------------------------------------------------------
  const guard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: 403 });
  }

  // ------------------------------------------------------------------
  // 3. Parse the workbook
  // ------------------------------------------------------------------
  const buffer = Buffer.from(await file.arrayBuffer());
  let parseResult: Awaited<ReturnType<typeof parseTenantSchedule>>;
  // Normal parse failures (bad rows, wrong columns, non-xlsx content) are NOT
  // thrown — parseTenantSchedule returns them as a normal result with
  // parse_errors populated (HTTP 200).  This catch only fires on an unexpected
  // crash inside the parser (e.g. out-of-memory, unhandled workbook edge case).
  try {
    parseResult = await parseTenantSchedule(buffer);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Unexpected parser error: ${e?.message ?? 'unknown'}` },
      { status: 422 },
    );
  }

  // ------------------------------------------------------------------
  // 4. Load ALL project nodes (read-only — RLS-gated via the server client).
  //    The tenant_db subset drives shop_number matching; the full set drives
  //    code-collision detection (a new shop whose derived DB code is already
  //    taken by, e.g., a cable-schedule board).
  // ------------------------------------------------------------------
  let allNodes: Awaited<ReturnType<typeof listNodes>>;
  try {
    allNodes = await listNodes(supabase, projectId);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Could not load project nodes: ${e?.message ?? 'unknown'}` },
      { status: 500 },
    );
  }

  // ------------------------------------------------------------------
  // 5. Diff → ImportPreview (pure, no DB writes)
  // ------------------------------------------------------------------
  const preview = diffTenantSchedule(
    parseResult.rows,
    parseResult.errors,
    allNodes,
    parseResult.warnings,
  );

  return NextResponse.json(preview, { status: 200 });
}
