'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JbccParty {
  id: string
  project_id: string
  organisation_id: string
  party_role: string
  name: string
  company: string | null
  address: string | null
  email: string | null
  phone: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// ─── Input schema ─────────────────────────────────────────────────────────────

const partyInputSchema = z.object({
  party_role: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  company: z.string().max(120).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  phone: z.string().max(50).nullable().optional(),
})

type PartyInput = z.infer<typeof partyInputSchema>

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolvePartyOrg(
  supabase: any,
  partyId: string,
): Promise<{ projectId: string; organisationId: string } | null> {
  const { data: party } = await (supabase as any)
    .schema('projects')
    .from('jbcc_parties')
    .select('project_id')
    .eq('id', partyId)
    .maybeSingle()
  if (!party) return null

  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', party.project_id)
    .maybeSingle()
  if (!project) return null

  return { projectId: party.project_id, organisationId: project.organisation_id }
}

function bust(projectId: string): void {
  revalidatePath(`/projects/${projectId}/settings/jbcc-parties`)
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function listJbccParties(
  projectId: string,
): Promise<{ parties: JbccParty[] } | { error: string }> {
  const supabase = await createClient()

  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('jbcc_parties')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (error) return { error: error.message }
  return { parties: (data ?? []) as unknown as JbccParty[] }
}

export async function createJbccParty(
  projectId: string,
  input: PartyInput,
): Promise<{ party: JbccParty } | { error: string }> {
  const parsed = partyInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()

  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return { error: 'Project not found' }

  const guard = await requireRole(supabase, project.organisation_id, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('jbcc_parties')
    .insert({
      project_id: projectId,
      organisation_id: project.organisation_id,
      party_role: parsed.data.party_role,
      name: parsed.data.name,
      company: parsed.data.company ?? null,
      address: parsed.data.address ?? null,
      email: parsed.data.email || null,
      phone: parsed.data.phone ?? null,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }
  bust(projectId)
  return { party: data as unknown as JbccParty }
}

export async function updateJbccParty(
  partyId: string,
  input: PartyInput,
): Promise<{ party: JbccParty } | { error: string }> {
  const parsed = partyInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const resolved = await resolvePartyOrg(supabase, partyId)
  if (!resolved) return { error: 'Party not found' }

  const guard = await requireRole(supabase, resolved.organisationId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('jbcc_parties')
    .update({
      party_role: parsed.data.party_role,
      name: parsed.data.name,
      company: parsed.data.company ?? null,
      address: parsed.data.address ?? null,
      email: parsed.data.email || null,
      phone: parsed.data.phone ?? null,
    })
    .eq('id', partyId)
    .select('*')
    .single()

  if (error) return { error: error.message }
  bust(resolved.projectId)
  return { party: data as unknown as JbccParty }
}

export async function deleteJbccParty(
  partyId: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient()
  const resolved = await resolvePartyOrg(supabase, partyId)
  if (!resolved) return { error: 'Party not found' }

  const guard = await requireRole(supabase, resolved.organisationId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { error } = await (supabase as any)
    .schema('projects')
    .from('jbcc_parties')
    .delete()
    .eq('id', partyId)

  if (error) return { error: error.message }
  bust(resolved.projectId)
  return { ok: true }
}
