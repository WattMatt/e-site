'use server'

/**
 * tenant-entry.actions.ts — edit a tenant entry's identity fields from the
 * Tenant Schedule (shop_number / shop_name / shop_area_m2 on structure.nodes).
 *
 * Rules mirrored from the Excel-import design (00080 / commit route §3):
 *   - `code` is derived ONCE at creation and is IMMUTABLE here — cable feeds,
 *     CoCs and reports hang off it.
 *   - shop_number must stay unique among live tenant_db nodes in the project:
 *     the import diff (update / decommission matching) keys on it, so a manual
 *     duplicate would silently corrupt the next re-import. The DB has no unique
 *     constraint on shop_number, so the action enforces it.
 *   - shop_area_m2 is nullable — a blank area means "GLA pending", identical to
 *     the pending-area import semantics.
 *
 * Cross-schema write pattern (CLAUDE.md 2026-05-18 gotcha): supabase-js
 * `.schema(...)` strips the service-role header on writes → RLS denies. The
 * PATCH uses a raw PostgREST fetch with Content-Profile + service-role key;
 * reads go through the RLS-gated cookie client. Because the write runs as
 * service_role, authorisation is enforced here (auth + project visibility +
 * owner/admin/project_manager role), matching the nodes RLS write policy.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid()

const WRITE_ROLES = ['owner', 'admin', 'project_manager'] as const

const updateTenantEntrySchema = z.object({
  projectId: uuidSchema,
  nodeId: uuidSchema,
  shopNumber: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'SHOP NO. is required').max(80)),
  shopName: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(200))
    .nullable(),
  shopAreaM2: z.number().finite().nonnegative('GLA cannot be negative').nullable(),
})

// ---------------------------------------------------------------------------
// Guard (mirrors tenant-bo.actions.ts guardWriter)
// ---------------------------------------------------------------------------

type GuardResult =
  | { error: string; supabase?: undefined }
  | { error?: undefined; supabase: Awaited<ReturnType<typeof createClient>> }

async function guardWriter(projectId: string): Promise<GuardResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  let project: { organisation_id: string } | null
  try {
    project = (await projectService.getById(supabase as never, projectId)) as {
      organisation_id: string
    }
  } catch {
    project = null
  }
  if (!project) return { error: 'Project not found' }

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('role')
    .eq('user_id', user.id)
    .eq('organisation_id', project.organisation_id)
    .eq('is_active', true)
    .maybeSingle()

  const role = (membership as { role: string } | null)?.role
  if (!role || !WRITE_ROLES.includes(role as (typeof WRITE_ROLES)[number])) {
    return { error: 'You do not have permission to edit tenant entries.' }
  }

  return { supabase }
}

// ---------------------------------------------------------------------------
// updateTenantEntryAction
// ---------------------------------------------------------------------------

export type UpdateTenantEntryResult = { ok: true } | { error: string }

export async function updateTenantEntryAction(
  projectId: string,
  nodeId: string,
  fields: { shopNumber: string; shopName: string | null; shopAreaM2: number | null },
): Promise<UpdateTenantEntryResult> {
  const parsed = updateTenantEntrySchema.safeParse({ projectId, nodeId, ...fields })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardWriter(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  // The node must be a live (not soft-deleted) tenant of this project.
  // Reads via .schema() are safe — the cross-schema gotcha is writes-only.
  const { data: node } = await guard.supabase
    .schema('structure')
    .from('nodes')
    .select('id, shop_number')
    .eq('id', nodeId)
    .eq('project_id', projectId)
    .eq('kind', 'tenant_db')
    .is('deleted_at', null)
    .maybeSingle()
  if (!node) return { error: 'Tenant not found' }

  // shop_number uniqueness among the project's tenants (self excluded).
  // Soft-deleted tenants COUNT: a binned tenant can be restored with its
  // shop_number intact (restore re-checks only the code), so its number stays
  // reserved. Fails closed: a query error blocks the write rather than
  // waving a possible duplicate through.
  // (as any: generated DB types lag the 00123 soft-delete columns — same
  // workaround as the sibling tenant-delete/tenant-documents actions.)
  const { data: clashes, error: clashErr } = await (guard.supabase as any)
    .schema('structure')
    .from('nodes')
    .select('id, deleted_at')
    .eq('project_id', projectId)
    .eq('kind', 'tenant_db')
    .eq('shop_number', parsed.data.shopNumber)
    .neq('id', nodeId)
    .limit(1)
  if (clashErr) {
    return { error: 'Could not verify SHOP NO. uniqueness — please try again.' }
  }
  const clash = (clashes ?? [])[0] as { id: string; deleted_at: string | null } | undefined
  if (clash) {
    return {
      error:
        `SHOP NO. "${parsed.data.shopNumber}" is already used by another tenant in this project` +
        (clash.deleted_at ? ' (currently in the recycle bin — its number stays reserved until permanently deleted).' : '.'),
    }
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const res = await fetch(`${supabaseUrl}/rest/v1/nodes?id=eq.${nodeId}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'structure',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      shop_number: parsed.data.shopNumber,
      shop_name: parsed.data.shopName,
      shop_area_m2: parsed.data.shopAreaM2,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    // 23505 on nodes_project_shop_number_tenant_live (00154): the DB-level
    // uniqueness backstop caught a race the pre-check above missed.
    if (text.includes('nodes_project_shop_number_tenant_live') || text.includes('23505')) {
      return {
        error: `SHOP NO. "${parsed.data.shopNumber}" is already used by another tenant in this project.`,
      }
    }
    return { error: `Update failed (HTTP ${res.status}): ${text.slice(0, 300)}` }
  }

  // Every consumer reads structure.nodes live; revalidate the server-rendered
  // pages that show tenant identity fields.
  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  revalidatePath(`/projects/${projectId}/cables`)
  revalidatePath(`/projects/${projectId}/equipment-schedule`)
  revalidatePath(`/projects/${projectId}/equipment-materials`)
  revalidatePath(`/projects/${projectId}/generator-cost-recovery`)
  return { ok: true }
}
