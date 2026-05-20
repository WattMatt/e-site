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
 * Project access is verified via an RLS-gated projects.projects read.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  parseTenantSchedule,
  listNodes,
  diffTenantSchedule,
} from '@esite/shared';
import type { ImportPreview } from '@esite/shared';

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
  // 4. Load existing tenant_db nodes for this project
  //    (read-only — RLS-gated via the server client; no service-role needed)
  // ------------------------------------------------------------------
  let existingNodes: Awaited<ReturnType<typeof listNodes>>;
  try {
    existingNodes = await listNodes(supabase, projectId, { kind: 'tenant_db' });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Could not load existing tenant nodes: ${e?.message ?? 'unknown'}` },
      { status: 500 },
    );
  }

  // ------------------------------------------------------------------
  // 5. Diff → ImportPreview (pure, no DB writes)
  // ------------------------------------------------------------------
  const preview = diffTenantSchedule(parseResult.rows, parseResult.errors, existingNodes);

  return NextResponse.json(preview, { status: 200 });
}
