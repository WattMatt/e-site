'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Contact {
  id: string
  project_id: string
  organisation_id: string
  name: string
  role: string | null
  company: string | null
  email: string | null
  phone: string | null
  created_at: string
}

// ─── Input schema ─────────────────────────────────────────────────────────────

const contactInputSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.string().max(120).nullable().optional(),
  company: z.string().max(120).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  phone: z.string().max(50).nullable().optional(),
})

type ContactInput = z.infer<typeof contactInputSchema>

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveContactOrg(
  supabase: any,
  contactId: string,
): Promise<{ projectId: string; organisationId: string } | null> {
  const { data: contact } = await (supabase as any)
    .schema('projects')
    .from('contacts')
    .select('project_id')
    .eq('id', contactId)
    .maybeSingle()
  if (!contact) return null

  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', contact.project_id)
    .maybeSingle()
  if (!project) return null

  return { projectId: contact.project_id, organisationId: project.organisation_id }
}

function bust(projectId: string): void {
  revalidatePath(`/projects/${projectId}/settings/contacts`)
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function listProjectContacts(
  projectId: string,
): Promise<{ contacts: Contact[] } | { error: string }> {
  const supabase = await createClient()

  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('contacts')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (error) return { error: error.message }
  return { contacts: (data ?? []) as Contact[] }
}

export async function createProjectContact(
  projectId: string,
  input: ContactInput,
): Promise<{ contact: Contact } | { error: string }> {
  const parsed = contactInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()

  // Resolve org for this project to gate by
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
    .from('contacts')
    .insert({
      project_id: projectId,
      organisation_id: project.organisation_id,
      name: parsed.data.name,
      role: parsed.data.role ?? null,
      company: parsed.data.company ?? null,
      email: parsed.data.email || null,
      phone: parsed.data.phone ?? null,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }
  bust(projectId)
  return { contact: data as Contact }
}

export async function updateProjectContact(
  contactId: string,
  input: ContactInput,
): Promise<{ contact: Contact } | { error: string }> {
  const parsed = contactInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const resolved = await resolveContactOrg(supabase, contactId)
  if (!resolved) return { error: 'Contact not found' }

  const guard = await requireRole(supabase, resolved.organisationId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('contacts')
    .update({
      name: parsed.data.name,
      role: parsed.data.role ?? null,
      company: parsed.data.company ?? null,
      email: parsed.data.email || null,
      phone: parsed.data.phone ?? null,
    })
    .eq('id', contactId)
    .select('*')
    .single()

  if (error) return { error: error.message }
  bust(resolved.projectId)
  return { contact: data as Contact }
}

export async function deleteProjectContact(
  contactId: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient()
  const resolved = await resolveContactOrg(supabase, contactId)
  if (!resolved) return { error: 'Contact not found' }

  const guard = await requireRole(supabase, resolved.organisationId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { error } = await (supabase as any)
    .schema('projects')
    .from('contacts')
    .delete()
    .eq('id', contactId)

  if (error) return { error: error.message }
  bust(resolved.projectId)
  return { ok: true }
}
