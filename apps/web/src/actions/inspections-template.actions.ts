'use server'

/**
 * Inspection template library — server actions.
 *
 * Org-scoped CRUD against `inspections.templates`. Owner/admin only for
 * mutating actions. Schema-validates incoming JSON via the shared
 * `templateSchema` (Zod) before write.
 *
 * The `inspections` schema is not in the generated DB types yet, so the
 * supabase client is cast to `any` at each call site — same pattern as the
 * cable_schedule pages did before types were regenerated.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { templateSchema } from '@esite/shared'
import { bumpSemver } from '@/lib/inspections/bump-semver'

type AnyClient = SupabaseClient<any, any, any>

async function requireOwnerOrAdmin(
  supabase: AnyClient,
  organisationId: string,
) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('role')
    .eq('user_id', user.id)
    .eq('organisation_id', organisationId)
    .eq('is_active', true)
    .single()

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw new Error('Forbidden: owner or admin only')
  }
  return user
}

// ─── listTemplatesAction ────────────────────────────────────────────────

export async function listTemplatesAction(organisationId: string) {
  const supabase = await createClient()
  const { data, error } = await (supabase as AnyClient)
    .schema('inspections')
    .from('templates')
    .select(
      'id, template_id, version, name, applies_to_node_types, node_subtypes, deliverable_type, is_active, created_at, updated_at',
    )
    .eq('organisation_id', organisationId)
    .order('template_id', { ascending: true })
    .order('version', { ascending: false })

  if (error) throw error
  return (data ?? []) as Array<{
    id: string
    template_id: string
    version: string
    name: string
    applies_to_node_types: string[]
    node_subtypes: string[] | null
    deliverable_type: 'coc' | 'inspection_only' | 'factory_test'
    is_active: boolean
    created_at: string
    updated_at: string
  }>
}

// ─── getTemplateAction ──────────────────────────────────────────────────

export async function getTemplateAction(id: string) {
  const supabase = await createClient()
  const { data, error } = await (supabase as AnyClient)
    .schema('inspections')
    .from('templates')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

// ─── createTemplateAction ───────────────────────────────────────────────

export async function createTemplateAction(
  organisationId: string,
  jsonText: string,
) {
  const supabase = await createClient()
  const user = await requireOwnerOrAdmin(supabase, organisationId)

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`)
  }

  const result = templateSchema.safeParse(parsed)
  if (!result.success) {
    const detail = result.error.errors
      .map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`)
      .join('; ')
    throw new Error('Schema validation failed: ' + detail)
  }
  const t = result.data

  const { data, error } = await (supabase as AnyClient)
    .schema('inspections')
    .from('templates')
    .insert({
      organisation_id: organisationId,
      template_id: t.template_id,
      version: t.version,
      name: t.name,
      applies_to_node_types: t.applies_to_node_types,
      node_subtypes: t.node_subtypes ?? null,
      sans_reference: t.sans_reference ?? null,
      deliverable_type: t.deliverable_type,
      schema_json: t,
      is_active: true,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error(
        `Template (${t.template_id}, ${t.version}) already exists. Bump the version to upload changes.`,
      )
    }
    throw error
  }

  revalidatePath('/inspections/templates')
  return (data as { id: string }).id
}

// ─── updateTemplateMetadataAction ───────────────────────────────────────

export async function updateTemplateMetadataAction(
  id: string,
  organisationId: string,
  patch: {
    name?: string
    applies_to_node_types?: string[]
    node_subtypes?: string[] | null
    sans_reference?: string | null
    is_active?: boolean
  },
) {
  const supabase = await createClient()
  await requireOwnerOrAdmin(supabase, organisationId)

  const { error } = await (supabase as AnyClient)
    .schema('inspections')
    .from('templates')
    .update(patch)
    .eq('id', id)

  if (error) throw error
  revalidatePath('/inspections/templates')
  revalidatePath(`/inspections/templates/${id}`)
}

// ─── cloneTemplateToNewVersionAction ────────────────────────────────────

/**
 * Load an existing template row, bump its version, and return the
 * in-memory draft — WITHOUT persisting it.
 *
 * The caller (builder UI) hydrates its local state with this draft.
 * The user saves explicitly via createTemplateAction / newTemplateVersionAction.
 *
 * Collision loop: if the immediately-bumped version already exists (rare —
 * multiple drafts in flight), we keep bumping until we find a free slot.
 * This prevents the builder opening on a version string that would 23505 on
 * save without any obvious explanation.
 */
export async function cloneTemplateToNewVersionAction(
  templateId: string,
  currentVersion: string,
): Promise<
  | {
      ok: true
      draft: {
        template_id: string
        version: string
        name: string
        deliverable_type: string
        sans_reference?: string
        schema_json: Record<string, unknown>
      }
    }
  | { ok: false; error: string }
> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Not authenticated' }

    // Resolve the user's org (takes the first active org they belong to).
    const { data: memberships } = await (supabase as AnyClient)
      .from('user_organisations')
      .select('organisation_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
    const orgId = memberships?.[0]?.organisation_id as string | undefined
    if (!orgId) return { ok: false, error: 'No active organisation' }

    // Fetch source row.
    const { data: source, error: fetchErr } = await (supabase as AnyClient)
      .schema('inspections')
      .from('templates')
      .select('template_id, version, name, deliverable_type, sans_reference, schema_json')
      .eq('organisation_id', orgId)
      .eq('template_id', templateId)
      .eq('version', currentVersion)
      .single()

    if (fetchErr || !source) {
      return { ok: false, error: 'Template not found' }
    }

    const row = source as {
      template_id: string
      version: string
      name: string
      deliverable_type: string
      sans_reference?: string
      schema_json: Record<string, unknown>
    }

    // Bump version, then loop until a free slot is found.
    let candidate: string
    try {
      candidate = bumpSemver(currentVersion)
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }

    // Collision check loop (usually exits on first iteration).
    let attempts = 0
    while (attempts < 20) {
      const { data: collision } = await (supabase as AnyClient)
        .schema('inspections')
        .from('templates')
        .select('id')
        .eq('organisation_id', orgId)
        .eq('template_id', templateId)
        .eq('version', candidate)
        .maybeSingle()

      if (!collision) break // free slot found
      candidate = bumpSemver(candidate)
      attempts++
    }

    const draft = {
      template_id: row.template_id,
      version: candidate,
      name: row.name,
      deliverable_type: row.deliverable_type,
      ...(row.sans_reference ? { sans_reference: row.sans_reference } : {}),
      schema_json: {
        ...(row.schema_json as Record<string, unknown>),
        version: candidate, // keep schema_json.version in sync
      },
    }

    return { ok: true, draft }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─── deactivateTemplateAction ────────────────────────────────────────────

/**
 * Flip is_active → false for a specific template version.
 * Hides it from the new-inspection picker; existing inspections still render.
 * Owner or admin only (delegates to updateTemplateMetadataAction pattern).
 */
export async function deactivateTemplateAction(
  id: string,
  organisationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = await createClient()
    await requireOwnerOrAdmin(supabase as AnyClient, organisationId)

    const { error } = await (supabase as AnyClient)
      .schema('inspections')
      .from('templates')
      .update({ is_active: false })
      .eq('id', id)
      .eq('organisation_id', organisationId)

    if (error) return { ok: false, error: error.message }

    revalidatePath('/inspections/templates')
    revalidatePath(`/inspections/templates/${id}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─── reactivateTemplateAction ─────────────────────────────────────────────

/**
 * Flip is_active → true for a previously deactivated template version.
 * Owner or admin only.
 */
export async function reactivateTemplateAction(
  id: string,
  organisationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = await createClient()
    await requireOwnerOrAdmin(supabase as AnyClient, organisationId)

    const { error } = await (supabase as AnyClient)
      .schema('inspections')
      .from('templates')
      .update({ is_active: true })
      .eq('id', id)
      .eq('organisation_id', organisationId)

    if (error) return { ok: false, error: error.message }

    revalidatePath('/inspections/templates')
    revalidatePath(`/inspections/templates/${id}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─── deleteTemplateAction ─────────────────────────────────────────────────

/**
 * Permanently delete a specific template version.
 *
 * Gated: owner ONLY.
 * Blocked if any inspection references (template_id, version) — those must
 * be deleted or abandoned first.
 * Type-to-confirm: caller must pass the exact string
 * `delete-template-{template_id}-{version}` as confirmText.
 */
export async function deleteTemplateAction(
  id: string,
  organisationId: string,
  confirmText: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = await createClient()

    // Owner only.
    const { data: { user } } = await (supabase as AnyClient).auth.getUser()
    if (!user) redirect('/login')

    const { data: membership } = await (supabase as AnyClient)
      .from('user_organisations')
      .select('role')
      .eq('user_id', user.id)
      .eq('organisation_id', organisationId)
      .eq('is_active', true)
      .single()

    if (!membership || membership.role !== 'owner') {
      return { ok: false, error: 'Only the organisation owner can delete templates' }
    }

    // Fetch the template row to validate existence + build confirm string.
    const { data: template } = await (supabase as AnyClient)
      .schema('inspections')
      .from('templates')
      .select('id, template_id, version')
      .eq('id', id)
      .eq('organisation_id', organisationId)
      .single()

    if (!template) return { ok: false, error: 'Template not found' }

    const row = template as { id: string; template_id: string; version: string }
    const expectedConfirm = `delete-template-${row.template_id}-${row.version}`

    if (confirmText !== expectedConfirm) {
      return { ok: false, error: 'Confirmation text does not match' }
    }

    // Referential integrity check — block if any inspection references this version.
    const { count } = await (supabase as AnyClient)
      .schema('inspections')
      .from('inspections')
      .select('id', { count: 'exact', head: true })
      .eq('template_id', row.template_id)
      .eq('template_version', row.version)
      .eq('organisation_id', organisationId)

    const refCount = (count as number | null) ?? 0
    if (refCount > 0) {
      return {
        ok: false,
        error: `${refCount} inspection${refCount === 1 ? '' : 's'} reference${refCount === 1 ? 's' : ''} this template version — delete or abandon those first`,
      }
    }

    const { error } = await (supabase as AnyClient)
      .schema('inspections')
      .from('templates')
      .delete()
      .eq('id', id)
      .eq('organisation_id', organisationId)

    if (error) return { ok: false, error: error.message }

    revalidatePath('/inspections/templates')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─── getTemplateInspectionCountAction ────────────────────────────────────

/**
 * Return the number of inspections that reference a specific template version.
 * Used by the delete modal to show a blocking message before the user types
 * the confirmation string.
 */
export async function getTemplateInspectionCountAction(
  templateId: string,
  version: string,
  organisationId: string,
): Promise<number> {
  const supabase = await createClient()
  const { count } = await (supabase as AnyClient)
    .schema('inspections')
    .from('inspections')
    .select('id', { count: 'exact', head: true })
    .eq('template_id', templateId)
    .eq('template_version', version)
    .eq('organisation_id', organisationId)
  return (count as number | null) ?? 0
}

// ─── newTemplateVersionAction ───────────────────────────────────────────

export async function newTemplateVersionAction(
  sourceId: string,
  organisationId: string,
  newVersion: string,
  newSchemaJsonText: string,
) {
  const supabase = await createClient()
  const user = await requireOwnerOrAdmin(supabase, organisationId)

  let parsed: unknown
  try {
    parsed = JSON.parse(newSchemaJsonText)
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`)
  }

  const result = templateSchema.safeParse(parsed)
  if (!result.success) {
    const detail = result.error.errors
      .map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`)
      .join('; ')
    throw new Error('Schema validation failed: ' + detail)
  }
  const t = result.data

  if (t.version !== newVersion) {
    throw new Error(
      `Version in JSON (${t.version}) does not match new version field (${newVersion})`,
    )
  }

  const { data: source } = await (supabase as AnyClient)
    .schema('inspections')
    .from('templates')
    .select('template_id')
    .eq('id', sourceId)
    .single()

  if (!source) throw new Error('Source template not found')
  if ((source as { template_id: string }).template_id !== t.template_id) {
    throw new Error(
      `template_id mismatch — source is ${(source as { template_id: string }).template_id}, JSON has ${t.template_id}`,
    )
  }

  const { data, error } = await (supabase as AnyClient)
    .schema('inspections')
    .from('templates')
    .insert({
      organisation_id: organisationId,
      template_id: t.template_id,
      version: t.version,
      name: t.name,
      applies_to_node_types: t.applies_to_node_types,
      node_subtypes: t.node_subtypes ?? null,
      sans_reference: t.sans_reference ?? null,
      deliverable_type: t.deliverable_type,
      schema_json: t,
      is_active: true,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error(
        `Template (${t.template_id}, ${t.version}) already exists. Bump the version field.`,
      )
    }
    throw error
  }

  revalidatePath('/inspections/templates')
  return (data as { id: string }).id
}
