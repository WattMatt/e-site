'use server'

/**
 * Project Rates / BOQ server actions: list / import / update-rate / delete.
 *
 * Shape mirrors project-settings.actions.ts:
 *   1. createClient() (cookie/RLS client) — used for the auth + role gate.
 *   2. Resolve project → organisation_id so we gate against the *project's* org.
 *   3. requireEffectiveRole(supabase, projectId, roles) — project-scoped gate
 *      (honours per-project role overrides; see migration 00107).
 *   4. Service-role (RLS-bypassing) reads/writes sit BEHIND the gate, via
 *      createServiceClient(). The boq_* RLS only allows owner/admin/PM to write
 *      and project-members to read; the app layer narrows reads to
 *      COST_VIEW_ROLES (matching how contract_value is gated).
 *   5. { data } | { error } result; revalidatePath after writes.
 *
 * Profiles-RLS lesson: the importer's display name is resolved via the SERVICE
 * client after the gate — the caller's RLS client only returns their OWN
 * public.profiles row.
 */

import { revalidatePath } from 'next/cache'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import {
  boqService,
  computeRollups,
  boqItemRatePatchSchema,
  COST_VIEW_ROLES,
  ORG_WRITE_ROLES,
  type BoqImport,
  type BoqSection,
  type BoqItem,
  type BoqItemRatePatch,
} from '@esite/shared'
import type { ParsedBoq } from '@/lib/boq/types'
import { flattenForPersist } from '@/lib/boq/flatten-for-persist'

function bust(projectId: string): void {
  revalidatePath(`/projects/${projectId}/settings/rates`, 'page')
}

async function resolveProjectOrg(
  supabase: any,
  projectId: string,
): Promise<{ organisationId: string } | null> {
  const { data } = await supabase
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!data) return null
  return { organisationId: data.organisation_id }
}

// ─── listBoqAction ──────────────────────────────────────────────────────────

export type ListBoqResult =
  | {
      data: {
        import: BoqImport | null
        sections: BoqSection[]
        items: BoqItem[]
        totals: Record<string, number>
        importedByName: string | null
      }
    }
  | { error: string }

export async function listBoqAction(projectId: string): Promise<ListBoqResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  try {
    const current = await boqService.getCurrent(supabase as any, projectId)
    if (!current) {
      return {
        data: { import: null, sections: [], items: [], totals: {}, importedByName: null },
      }
    }

    const { sections, items } = await boqService.getTree(supabase as any, current.id)
    const totals = Object.fromEntries(computeRollups(sections, items))

    // Resolve the importer's display name via the SERVICE client (profiles RLS
    // only returns the caller's own row to the cookie client).
    let importedByName: string | null = null
    if (current.importedBy) {
      const service = createServiceClient()
      const { data: profile } = await (service as any)
        .from('profiles')
        .select('full_name, email')
        .eq('id', current.importedBy)
        .maybeSingle()
      importedByName = profile?.full_name ?? profile?.email ?? null
    }

    return { data: { import: current, sections, items, totals, importedByName } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to load BOQ' }
  }
}

// ─── importBoqAction ────────────────────────────────────────────────────────

export type ImportBoqResult = { data: { import: BoqImport } } | { error: string }

export async function importBoqAction(
  projectId: string,
  parsed: ParsedBoq,
  sourceFilename: string,
  storagePath: string | null,
): Promise<ImportBoqResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const proj = await resolveProjectOrg(supabase, projectId)
  if (!proj) return { error: 'Project not found' }

  const { data: { user } } = await supabase.auth.getUser()

  try {
    const flat = flattenForPersist(parsed)
    const service = createServiceClient()
    const imported = await boqService.persistImport(service as any, {
      projectId,
      organisationId: proj.organisationId,
      sourceFilename,
      storagePath,
      importedBy: user?.id ?? null,
      totals: flat.totals,
      sections: flat.sections,
      items: flat.items,
    })
    bust(projectId)
    return { data: { import: imported } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Import failed' }
  }
}

// ─── updateBoqItemRateAction ────────────────────────────────────────────────

export type UpdateBoqItemRateResult = { data: { item: BoqItem } } | { error: string }

export async function updateBoqItemRateAction(
  projectId: string,
  itemId: string,
  patch: BoqItemRatePatch,
): Promise<UpdateBoqItemRateResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const parsedPatch = boqItemRatePatchSchema.safeParse(patch)
  if (!parsedPatch.success) {
    return { error: parsedPatch.error.issues[0]?.message ?? 'Invalid rate patch' }
  }

  // Cross-project guard: resolve the item's owning project (item → section →
  // import) via the service client and refuse if it isn't this project. Done
  // BEFORE any write so a forged item id from another project cannot be edited.
  const service = createServiceClient()
  const { data: owner } = await (service as any)
    .schema('projects')
    .from('boq_items')
    .select('id, boq_sections!inner(import_id, boq_imports!inner(project_id))')
    .eq('id', itemId)
    .maybeSingle()

  const ownerProjectId = owner?.boq_sections?.boq_imports?.project_id
  if (!owner || ownerProjectId !== projectId) {
    return { error: 'Not found' }
  }

  try {
    const item = await boqService.updateItemRate(service as any, itemId, parsedPatch.data)
    bust(projectId)
    return { data: { item } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Update failed' }
  }
}

// ─── deleteBoqImportAction ──────────────────────────────────────────────────

export type DeleteBoqImportResult = { data: { deleted: true } } | { error: string }

export async function deleteBoqImportAction(
  projectId: string,
  importId: string,
): Promise<DeleteBoqImportResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const service = createServiceClient()

  // Load the import; confirm it belongs to this project and is not current.
  const { data: imp } = await (service as any)
    .schema('projects')
    .from('boq_imports')
    .select('id, project_id, is_current')
    .eq('id', importId)
    .maybeSingle()

  if (!imp || imp.project_id !== projectId) return { error: 'Not found' }
  if (imp.is_current) {
    return { error: 'Cannot delete the current BOQ import. Import a replacement first.' }
  }

  try {
    const { error } = await (service as any)
      .schema('projects')
      .from('boq_imports')
      .delete()
      .eq('id', importId)
    if (error) throw new Error(error.message)
    bust(projectId)
    return { data: { deleted: true } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Delete failed' }
  }
}
