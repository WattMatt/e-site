import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { rfiService } from './rfi.service'
import { projectSettingsService } from './project-settings.service'

/**
 * Live-DB battle test for two fixes:
 *   1. rfiService.create resolves the project default assignee (was dead code).
 *   2. Migration 00145 denies a read-only client_viewer from writing diary
 *      entries (was an org-wide RLS hole).
 *
 * Self-contained: creates its own org, two auth users (an internal PM and a
 * client_viewer), a project, and project_settings; tears it all down after.
 *
 * Requires a running local Supabase + env:
 *   RUN_INTEGRATION_TESTS=true
 *   NEXT_PUBLIC_SUPABASE_URL  (or SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY
 *
 * Run: RUN_INTEGRATION_TESTS=true ... pnpm --filter @esite/shared exec \
 *        vitest run src/services/rfi-diary-fixes.integration.test.ts
 */

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true'
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON = process.env.SUPABASE_ANON_KEY ?? ''

describe.skipIf(!runIntegration)('RFI assignee + diary write RLS — INTEGRATION (live DB)', () => {
  let admin: SupabaseClient
  let orgId: string
  let projectId: string
  let internalUserId: string
  let clientViewerId: string

  const ts = Date.now()
  const internalEmail = `it-internal-${ts}@example.com`
  const clientEmail = `it-client-${ts}@example.com`
  const PASSWORD = 'Test-Passw0rd!'

  beforeAll(async () => {
    if (!URL || !SERVICE || !ANON) {
      throw new Error('Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY')
    }
    admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: org, error: orgErr } = await (admin as any)
      .from('organisations')
      .insert({ name: `IT Org ${ts}`, slug: `it-org-${ts}` })
      .select('id')
      .single()
    if (orgErr) throw orgErr
    orgId = org.id

    // profiles are auto-created by the on_auth_user_created trigger.
    const mkUser = async (email: string, fullName: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (error || !data.user) throw error ?? new Error(`createUser failed for ${email}`)
      return data.user.id
    }
    internalUserId = await mkUser(internalEmail, 'Internal PM')
    clientViewerId = await mkUser(clientEmail, 'Client Viewer')

    const { error: memErr } = await (admin as any).from('user_organisations').insert([
      { user_id: internalUserId, organisation_id: orgId, role: 'project_manager', is_active: true },
      { user_id: clientViewerId, organisation_id: orgId, role: 'client_viewer', is_active: true },
    ])
    if (memErr) throw memErr

    // code + project_settings row are auto-created by triggers.
    const { data: proj, error: projErr } = await (admin as any)
      .schema('projects')
      .from('projects')
      .insert({ name: `IT Project ${ts}`, organisation_id: orgId, created_by: internalUserId })
      .select('id')
      .single()
    if (projErr) throw projErr
    projectId = proj.id

    // Make the client_viewer a project member too — proves even a
    // project-scoped viewer (who CAN read) is still denied writes.
    await (admin as any).schema('projects').from('project_members').insert([
      { project_id: projectId, organisation_id: orgId, user_id: clientViewerId, is_active: true },
      { project_id: projectId, organisation_id: orgId, user_id: internalUserId, is_active: true },
    ])
  }, 60_000)

  afterAll(async () => {
    // Best-effort teardown; leftover rows in a local dev DB are harmless.
    try {
      if (projectId) await (admin as any).schema('projects').from('projects').delete().eq('id', projectId)
    } catch { /* ignore */ }
    try {
      if (orgId) await (admin as any).from('user_organisations').delete().eq('organisation_id', orgId)
    } catch { /* ignore */ }
    try {
      if (orgId) await (admin as any).from('organisations').delete().eq('id', orgId)
    } catch { /* ignore */ }
    for (const uid of [internalUserId, clientViewerId]) {
      try { if (uid) await admin.auth.admin.deleteUser(uid) } catch { /* ignore */ }
    }
  }, 60_000)

  describe('rfiService.create — assignee resolution (against real DB)', () => {
    it('applies the project default assignee when none is supplied', async () => {
      await projectSettingsService.update(admin, projectId, { defaultRfiAssigneeId: internalUserId })
      const rfi: any = await rfiService.create(admin, orgId, internalUserId, {
        projectId,
        subject: 'Default-assignee RFI',
        description: 'A description long enough to be valid.',
        priority: 'medium',
      })
      expect(rfi.assigned_to).toBe(internalUserId)
    })

    it('prefers an explicit assignee over the project default', async () => {
      const rfi: any = await rfiService.create(admin, orgId, internalUserId, {
        projectId,
        subject: 'Explicit-assignee RFI',
        description: 'A description long enough to be valid.',
        priority: 'medium',
        assignedTo: clientViewerId,
      })
      expect(rfi.assigned_to).toBe(clientViewerId)
    })

    it('writes null assigned_to with no default, and coerces empty due_date to null', async () => {
      await projectSettingsService.update(admin, projectId, { defaultRfiAssigneeId: null })
      const rfi: any = await rfiService.create(admin, orgId, internalUserId, {
        projectId,
        subject: 'Unassigned RFI',
        description: 'A description long enough to be valid.',
        priority: 'medium',
        dueDate: '',
      })
      expect(rfi.assigned_to).toBeNull()
      expect(rfi.due_date).toBeNull()
    })
  })

  describe('site diary INSERT RLS — 00145 client_viewer guard', () => {
    const diaryRow = (createdBy: string) => ({
      project_id: projectId,
      organisation_id: orgId,
      entry_date: '2026-06-24',
      progress_notes: 'Integration test diary entry',
      created_by: createdBy,
    })

    const signIn = async (email: string) => {
      const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
      const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
      if (error) throw error
      return c
    }

    it('DENIES a client_viewer from inserting a diary entry', async () => {
      const c = await signIn(clientEmail)
      const { error } = await (c as any)
        .schema('projects')
        .from('site_diary_entries')
        .insert(diaryRow(clientViewerId))
      expect(error).not.toBeNull()
    })

    it('ALLOWS an internal project_manager to insert a diary entry', async () => {
      const c = await signIn(internalEmail)
      const { data, error } = await (c as any)
        .schema('projects')
        .from('site_diary_entries')
        .insert(diaryRow(internalUserId))
        .select('id')
        .single()
      expect(error).toBeNull()
      expect(data?.id).toBeTruthy()
    })
  })
})
