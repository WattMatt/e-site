'use server'

import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { trackServer, ANALYTICS_EVENTS } from '@/lib/analytics'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'

const createOrgSchema = z.object({
  name:               z.string().min(1, 'Organisation name is required.').max(200),
  orgType:            z.string().optional(),
  registrationNumber: z.string().max(50).optional(),
  vatNumber:          z.string().max(20).optional(),
})

const createProjectSchema = z.object({
  name:       z.string().min(1, 'Project name is required.').max(200),
  address:    z.string().max(500).optional(),
  city:       z.string().max(100).optional(),
  clientName: z.string().max(200).optional(),
})

const inviteSchema = z.object({
  email: z.string().email('Valid email address required.'),
  role:  z.string().optional(),
})

export async function createOrganisationAction(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const parsed = createOrgSchema.safeParse({
    name:               formData.get('name'),
    orgType:            formData.get('orgType') ?? undefined,
    registrationNumber: formData.get('registrationNumber') ?? undefined,
    vatNumber:          formData.get('vatNumber') ?? undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { name, orgType, registrationNumber, vatNumber } = parsed.data

  // Use service client to bypass RLS for initial org creation (new user has no org membership yet)
  const service = createServiceClient()

  const { data: org, error: orgErr } = await service
    .from('organisations')
    .insert({
      name: name.trim(),
      type: orgType ?? 'contractor',
      registration_number: registrationNumber?.trim() || null,
      vat_number: vatNumber?.trim() || null,
    })
    .select()
    .single()

  if (orgErr) return { error: orgErr.message }

  const { error: memErr } = await service
    .from('user_organisations')
    .insert({
      user_id: user.id,
      organisation_id: org.id,
      role: 'admin',
      is_active: true,
    })

  if (memErr) return { error: memErr.message }

  await service
    .from('profiles')
    .update({ popia_consent_at: new Date().toISOString() })
    .eq('id', user.id)

  await trackServer(user.id, ANALYTICS_EVENTS.ONBOARDING_STARTED, {
    org_id: org.id,
    org_type: orgType,
  })

  return { organisationId: org.id }
}

export async function createFirstProjectAction(orgId: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const parsed = createProjectSchema.safeParse({
    name:       formData.get('name'),
    address:    formData.get('address') ?? undefined,
    city:       formData.get('city') ?? undefined,
    clientName: formData.get('clientName') ?? undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { name, address, city, clientName } = parsed.data

  const { data: project, error } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .insert({
      organisation_id: orgId,
      created_by: user.id,
      name: name.trim(),
      address: address?.trim() || null,
      city: city?.trim() || null,
      client_name: clientName?.trim() || null,
      status: 'active',
    })
    .select()
    .single()

  if (error) return { error: error.message }

  await (supabase as any)
    .schema('projects')
    .from('project_members')
    .insert({ project_id: project.id, user_id: user.id, organisation_id: orgId, role: 'project_manager' })

  await trackServer(user.id, ANALYTICS_EVENTS.PROJECT_CREATED, {
    project_id: project.id,
    org_id: orgId,
    source: 'onboarding',
  })

  return { projectId: project.id }
}

export async function inviteTeamMemberAction(orgId: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  if (!rateLimit(`invite:${user.id}`, 10, 60 * 60_000)) {
    return { error: 'Too many invites. Please wait before sending more.' }
  }

  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    role:  formData.get('role') ?? undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { email, role } = parsed.data

  const { error } = await supabase.auth.admin.inviteUserByEmail(email.trim(), {
    data: {
      invited_to_org: orgId,
      invited_role: role ?? 'member',
    },
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/onboarding/join`,
  })

  if (error) return { error: error.message }

  return { invited: true }
}
