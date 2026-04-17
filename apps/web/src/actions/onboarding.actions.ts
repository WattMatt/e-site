'use server'

import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { trackServer, ANALYTICS_EVENTS } from '@/lib/analytics'

export async function createOrganisationAction(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const name = formData.get('name') as string
  const orgType = formData.get('orgType') as string
  const registrationNumber = formData.get('registrationNumber') as string
  const vatNumber = formData.get('vatNumber') as string

  if (!name?.trim()) return { error: 'Organisation name is required' }

  // Use service client to bypass RLS for initial org creation (new user has no org membership yet)
  const service = createServiceClient()

  // Create organisation
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

  // Link user as admin
  const { error: memErr } = await service
    .from('user_organisations')
    .insert({
      user_id: user.id,
      organisation_id: org.id,
      role: 'admin',
      is_active: true,
    })

  if (memErr) return { error: memErr.message }

  // Update profile with org
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

  const name = formData.get('name') as string
  const address = formData.get('address') as string
  const city = formData.get('city') as string
  const clientName = formData.get('clientName') as string

  if (!name?.trim()) return { error: 'Project name is required' }

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

  // Auto-add as project manager
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

  const email = formData.get('email') as string
  const role = formData.get('role') as string

  if (!email?.trim()) return { error: 'Email is required' }

  // Use Supabase admin invite
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
