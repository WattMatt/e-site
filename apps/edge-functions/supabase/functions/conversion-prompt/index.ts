/**
 * Edge Function: conversion-prompt
 *
 * Event-triggered — fired by the web project-creation server action the moment
 * an org's second project is created. Single POST per event with the new
 * project's id; the function resolves the org owner + project name and sends.
 *
 * Idempotent via email_sequence_events UNIQUE (user_id, 'conversion',
 * 'second_project') — the email sends exactly once per owner even if the
 * trigger fires repeatedly for the same org.
 *
 * Spec: spec-v2.md §18, build-action-plan.md Session 4.
 */

import {
  corsPreflight, jsonResponse, serviceRoleClient,
  sendSequenceEmail, getSiteUrl, unsubscribeUrlFor, requireServiceRole,
} from '../_shared/email-sequence.ts'
import { conversionPrompt } from '../_shared/email-templates/conversion-prompt.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const unauth = requireServiceRole(req)
  if (unauth) return unauth

  const body = await req.json().catch(() => null) as {
    projectId?: string
    organisationId?: string
  } | null

  if (!body?.projectId || !body.organisationId) {
    return jsonResponse({ error: 'projectId and organisationId are required' }, 400)
  }

  const supabase = serviceRoleClient()

  // Count the org's projects — only fire if this is the second project or
  // later. The client can fire this unconditionally on every project create;
  // we gate server-side so clients stay dumb.
  const { count } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('organisation_id', body.organisationId)

  if ((count ?? 0) < 2) {
    return jsonResponse({ skipped: 'first_project', project_count: count ?? 0 })
  }

  // Resolve project name + org owner.
  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('name')
    .eq('id', body.projectId)
    .maybeSingle()

  const { data: owner } = await (supabase as any)
    .from('user_organisations')
    .select('user_id, role, profile:profiles!user_id(id, full_name, email)')
    .eq('organisation_id', body.organisationId)
    .eq('role', 'org_admin')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  const ownerProfile = owner?.profile as { id: string; full_name: string | null; email: string | null } | null
  if (!ownerProfile?.id || !ownerProfile.email) {
    return jsonResponse({ error: 'Could not resolve org owner' }, 404)
  }

  const { subject, html } = conversionPrompt({
    firstName:   ownerProfile.full_name?.split(' ')[0] ?? '',
    projectName: project?.name ?? 'your new project',
    siteUrl:     getSiteUrl(),
    unsubscribeUrl: unsubscribeUrlFor(ownerProfile.id),
  })

  const result = await sendSequenceEmail(supabase, {
    userId:         ownerProfile.id,
    toEmail:        ownerProfile.email,
    organisationId: body.organisationId,
    sequence:       'conversion',
    step:           'second_project',
    subject,
    html,
    metadata: { project_id: body.projectId, project_count: count ?? 0 },
  })

  return jsonResponse(result, result.status === 'failed' ? 500 : 200)
})
