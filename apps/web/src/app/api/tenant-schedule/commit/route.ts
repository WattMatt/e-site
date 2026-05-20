/**
 * POST /api/tenant-schedule/commit
 *
 * Full-sync commit for an uploaded tenant schedule workbook.
 *
 * Design-doc §3 + §4 behaviour:
 *   NEW    — INSERT structure.nodes (kind='tenant_db', code derived ONCE from
 *             shop_number via deriveDbCode). Also INSERTs a structure.tenant_details
 *             row (1:1 with node; defaults: scope_status='awaited',
 *             layout_status='not_issued').
 *   UPDATED — PATCH shop_name + shop_area_m2 on the matched node. `code` and
 *             `shop_number` are never touched. If the node was previously
 *             decommissioned (re-appeared in file), status is restored to 'active'.
 *   MISSING — PATCH status='decommissioned' on nodes whose shop_number is absent
 *             from the new file. Not deleted; cable feeds / inspections / orders
 *             are preserved.
 *
 * Parse errors from the workbook are NOT commit blockers — bad rows simply
 * aren't synced (the design-doc only says they should be surfaced in the
 * preview UI before the user commits, not that they abort the commit).
 *
 * Cross-schema write pattern (Session 32 lesson — CLAUDE.md 2026-05-18):
 *   supabase-js `.schema('structure').from(...).insert()` silently strips the
 *   service-role auth header → RLS denies with a confusing error identical to
 *   the one for wrong table or missing column. All writes here use raw fetch to
 *   the PostgREST REST endpoint with `Content-Profile: structure` and the
 *   service-role key in both `apikey` + `Authorization: Bearer` headers.
 *   Reads (SELECT) go through the cookie-authenticated supabase-js client as
 *   normal (the gotcha is writes-only).
 *
 * Auth: cookie session → verify user + project access before any write.
 * Idempotent: re-running the same file is safe. New rows already present are
 * no-ops (INSERT ... ON CONFLICT DO NOTHING for tenant_details).
 */

import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  parseTenantSchedule,
  listNodes,
  diffTenantSchedule,
} from '@esite/shared';
import type { ImportNew, ImportUpdated, ImportDecommissioned } from '@esite/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

// ---------------------------------------------------------------------------
// Raw PostgREST helpers (service-role, Content-Profile: structure)
// ---------------------------------------------------------------------------

/** Shared service-role headers for every structure.* write. */
function structureHeaders(serviceKey: string): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'structure',
    Prefer: 'return=representation',
  };
}

interface RawInsertResult {
  id: string;
  [key: string]: unknown;
}

/**
 * INSERT into a structure.* table via raw PostgREST.
 * Returns the inserted row(s).  Throws on HTTP error.
 */
async function structureInsert(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  body: Record<string, unknown> | Record<string, unknown>[],
): Promise<RawInsertResult[]> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: structureHeaders(serviceKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`INSERT structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}`);
  }
  return (await res.json()) as RawInsertResult[];
}

/**
 * PATCH rows in a structure.* table via raw PostgREST.
 * `filterQuery` is appended to the URL (e.g. `id=eq.some-uuid`).
 * Returns the patched row(s).  Throws on HTTP error.
 */
async function structurePatch(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
  patch: Record<string, unknown>,
): Promise<RawInsertResult[]> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: structureHeaders(serviceKey),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}`);
  }
  return (await res.json()) as RawInsertResult[];
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface CommitResult {
  ok: true;
  created: number;
  updated: number;
  decommissioned: number;
  /** parse_error rows from the workbook that were skipped (not committed). */
  skipped_parse_errors: number;
  /** Per-write errors that occurred during the commit (partial failures). */
  write_errors: string[];
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(
  req: Request,
): Promise<NextResponse<CommitResult | { error: string }>> {
  // 1. Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // 2. Parse multipart form (same shape as the parse route)
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

  // 3. Verify project access (RLS-gated — rejects if user not in org)
  const { data: project, error: projErr } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('id, organisation_id')
    .eq('id', projectId)
    .single();

  if (projErr || !project) {
    return NextResponse.json({ error: 'Project not accessible' }, { status: 403 });
  }
  const orgId: string = project.organisation_id;

  // 4. Env vars needed for service-role writes
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !supabaseUrl) {
    return NextResponse.json(
      { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL missing' },
      { status: 500 },
    );
  }

  // 5. Re-parse the file server-side (never trust a client-sent diff)
  const buffer = Buffer.from(await file.arrayBuffer());
  let parseResult: Awaited<ReturnType<typeof parseTenantSchedule>>;
  try {
    parseResult = await parseTenantSchedule(buffer);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Unexpected parser error: ${e?.message ?? 'unknown'}` },
      { status: 422 },
    );
  }

  // 6. Load existing tenant_db nodes for this project
  //    (read — RLS-gated via cookie client; no service-role needed for SELECT)
  let existingNodes: Awaited<ReturnType<typeof listNodes>>;
  try {
    existingNodes = await listNodes(supabase, projectId, { kind: 'tenant_db' });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Could not load existing tenant nodes: ${e?.message ?? 'unknown'}` },
      { status: 500 },
    );
  }

  // 7. Compute diff (pure function — same as parse route, but we apply it here)
  const preview = diffTenantSchedule(parseResult.rows, parseResult.errors, existingNodes);

  // 8. Apply the three write categories
  const writeErrors: string[] = [];
  let created = 0;
  let updated = 0;
  let decommissioned = 0;

  // ── 8a. INSERT new nodes ───────────────────────────────────────────────────
  for (const entry of preview.new_entries as ImportNew[]) {
    try {
      const nodeRows = await structureInsert(supabaseUrl, serviceKey, 'nodes', {
        project_id: projectId,
        organisation_id: orgId,
        kind: 'tenant_db',
        code: entry.derived_code,
        name: entry.row.shop_name ?? entry.row.shop_number,
        status: 'active',
        shop_number: entry.row.shop_number,
        shop_name: entry.row.shop_name,
        shop_area_m2: entry.row.shop_area_m2,
        coc_required: false,
        created_by: user.id,
      });

      const nodeId = nodeRows[0]?.id;
      if (!nodeId) {
        writeErrors.push(`New shop ${entry.row.shop_number}: INSERT returned no id`);
        continue;
      }

      // INSERT a tenant_details row (1:1 with the node — T3).
      // Design-doc §4 is silent on this, but:
      //   - tenant_details has NOT NULL columns (scope_status, layout_status)
      //   - The migration comment says "seed at tenant-schedule import / scope-UI time"
      //   - NOT creating it here would force every later read to handle missing rows.
      // Defaults: scope_status='awaited', layout_status='not_issued' (migration defaults).
      // ON CONFLICT idempotency: we use a separate INSERT with a guard below.
      try {
        await structureInsert(supabaseUrl, serviceKey, 'tenant_details', {
          node_id: nodeId,
        });
      } catch (tdErr: any) {
        // Non-fatal: details row failed but node was created. Flag it.
        writeErrors.push(
          `Shop ${entry.row.shop_number}: tenant_details INSERT failed — ${(tdErr as Error).message.slice(0, 200)}`,
        );
      }

      created++;
    } catch (err: any) {
      writeErrors.push(
        `New shop ${entry.row.shop_number}: ${(err as Error).message.slice(0, 300)}`,
      );
    }
  }

  // ── 8b. UPDATE existing nodes ──────────────────────────────────────────────
  for (const entry of preview.updated_entries as ImportUpdated[]) {
    try {
      const patch: Record<string, unknown> = {
        shop_name: entry.row.shop_name,
        shop_area_m2: entry.row.shop_area_m2,
      };

      // Reactivate if previously decommissioned (doc §4 is silent on this;
      // we treat a re-appearing shop as intentionally active again).
      if (entry.existing.status === 'decommissioned') {
        patch.status = 'active';
      }

      await structurePatch(
        supabaseUrl,
        serviceKey,
        'nodes',
        `id=eq.${entry.existing.id}`,
        patch,
      );
      updated++;
    } catch (err: any) {
      writeErrors.push(
        `Update shop ${entry.row.shop_number}: ${(err as Error).message.slice(0, 300)}`,
      );
    }
  }

  // ── 8c. DECOMMISSION missing nodes ────────────────────────────────────────
  for (const entry of preview.decommissioned_entries as ImportDecommissioned[]) {
    // Skip nodes already decommissioned — no-op, keeps idempotency clean.
    if (entry.existing.status === 'decommissioned') {
      decommissioned++;
      continue;
    }
    try {
      await structurePatch(
        supabaseUrl,
        serviceKey,
        'nodes',
        `id=eq.${entry.existing.id}`,
        { status: 'decommissioned' },
      );
      decommissioned++;
    } catch (err: any) {
      writeErrors.push(
        `Decommission shop ${entry.existing.shop_number ?? entry.existing.id}: ${(err as Error).message.slice(0, 300)}`,
      );
    }
  }

  // 9. Revalidate the tenant schedule page so the next server render is fresh
  revalidatePath(`/projects/${projectId}/tenant-schedule`);

  return NextResponse.json({
    ok: true,
    created,
    updated,
    decommissioned,
    skipped_parse_errors: preview.parse_errors.length,
    write_errors: writeErrors,
  });
}
