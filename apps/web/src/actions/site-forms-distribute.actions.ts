'use server'

/**
 * Site-form distribution — issue the report, stamp the record, tell the team.
 *
 * Distribution is the moment a making-safe record stops being one electrician's
 * notes and becomes the project's shared statement of what state a board was
 * left in. Two actions live here:
 *
 * - `previewFormRecipientsAction` — the safety control. `project_notification_recipients()`
 *   resolves the FULL site roster (explicit members UNION implicit org
 *   owners/admins/PMs), which on a WM-Consulting project is a dozen real people.
 *   The reviewer must see the exact list and count before anything sends.
 * - `distributeSiteFormAction` — delegate → stamp → notify, in that order, so a
 *   distribution is never announced that the DB did not record.
 *
 * RBAC is deliberately narrower than capture: `FORMS_FIELD_ROLES` (which
 * includes `contractor`) may create, fill and submit a form, but distributing it
 * to the whole project team is a management act gated on `ORG_WRITE_ROLES` —
 * the same gate as voiding.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, projectSettingsService, ORG_WRITE_ROLES } from '@esite/shared'
import type { OrgRole } from '@esite/shared'
import { resolveProjectRecipients } from '@/lib/recipients'
import { notifySiteFormDistributed } from '@/lib/site-form-email'
import { generateAndFileSiteFormReport } from '@/lib/reports/file-site-form-report'

// `use server` files may only export async functions, so everything below that
// is not an action stays module-private — including the guards, which are
// deliberately re-stated here in the same shape as site-forms.actions.ts rather
// than imported from it (that file is also 'use server').
//
// The `field` schema is not in the generated DB types (same as `inspections`),
// so the client is cast per the house convention.
type AnyClient = SupabaseClient<any, any, any>

const uuid = z.string().uuid()

/** Statuses a completed record may be distributed from. */
const DISTRIBUTABLE_STATUSES = new Set(['submitted', 'distributed'])

type Guarded =
  | { ok: false; error: string }
  | { ok: true; supabase: AnyClient; orgId: string; userId: string }

/**
 * Resolve project → org, verify auth, enforce the role gate.
 *
 * requireEffectiveRole honours per-project promotion, so a contractor promoted
 * to project_manager on this project is treated as one.
 */
async function guardProject(
  projectId: string,
  roles: readonly OrgRole[] = ORG_WRITE_ROLES,
): Promise<Guarded> {
  const supabase = (await createClient()) as unknown as AnyClient
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const project = await projectService.getById(supabase as never, projectId)
  if (!project) return { ok: false, error: 'Project not found' }

  const gate = await requireEffectiveRole(supabase as never, projectId, roles)
  if (!gate.ok) return { ok: false, error: gate.error }

  return {
    ok: true,
    supabase,
    orgId: (project as { organisation_id: string }).organisation_id,
    userId: user.id,
  }
}

type FormLookup = { ok: false; error: string } | { ok: true; status: string }

/**
 * Confirm the form belongs to the project being acted on.
 *
 * The stamp below uses the service client, which bypasses RLS, so the project
 * link is proven rather than assumed — otherwise a valid form id from another
 * project would be distributable by anyone holding a role here.
 */
async function guardFormBelongsToProject(
  formId: string,
  projectId: string,
): Promise<FormLookup> {
  const service = createServiceClient() as unknown as AnyClient
  const { data, error } = await service
    .schema('field')
    .from('site_forms')
    .select('id, status, project_id')
    .eq('id', formId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (error) {
    return {
      ok: false,
      error: (error as { message?: string }).message ?? 'Could not load the form',
    }
  }
  if (!data) return { ok: false, error: 'Form not found on this project' }

  return { ok: true, status: (data as { status: string }).status }
}

function msg(e: unknown, fallback: string): string {
  return (e as { message?: string } | null)?.message ?? fallback
}

// ─── Recipient preview ───────────────────────────────────────────────────────

/**
 * Who would receive this project's form distribution, and whether email is on.
 *
 * Read-only and side-effect free, but gated on ORG_WRITE_ROLES all the same:
 * the roster is a list of real names and addresses, and only the people who can
 * actually press Distribute have a reason to see it.
 *
 * Resolved through the service client (inside resolveProjectRecipients) because
 * the caller usually cannot read cross-org profiles under RLS — a caller-scoped
 * read would silently show a shorter list than the one that actually gets mailed.
 */
export async function previewFormRecipientsAction(projectId: string): Promise<
  | { error: string; recipients?: undefined; emailEnabled?: undefined }
  | {
      error?: undefined
      recipients: { name: string | null; email: string }[]
      emailEnabled: boolean
    }
> {
  if (!uuid.safeParse(projectId).success) return { error: 'Invalid project id' }

  const guard = await guardProject(projectId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { recipients } = await resolveProjectRecipients(projectId)

  let emailEnabled: boolean
  try {
    const service = createServiceClient()
    const cfg = await projectSettingsService.getNotificationConfig(service as never, projectId)
    emailEnabled = Boolean(cfg.formEmail)
  } catch {
    // A settings read failure must not hide the roster — the count is the point
    // of this preview. Fall back to "email off" rather than claiming it is on.
    emailEnabled = false
  }

  return {
    // Only addressable recipients: a roster member without an email still gets
    // the in-app bell, but showing them here would overstate the mail audience.
    recipients: recipients
      .filter((r) => Boolean(r.email))
      .map((r) => ({ name: r.fullName, email: r.email as string })),
    emailEnabled,
  }
}

// ─── Distribute ──────────────────────────────────────────────────────────────

/**
 * Issue the report, stamp the form as distributed, and notify the project team.
 *
 * Order matters: the report is filed FIRST, so a failure there leaves the form
 * exactly as it was and the user can retry. Only once a report id exists is the
 * form stamped. The notification runs last and is best-effort — the record is
 * filed and distributed whether or not the mail leaves.
 *
 * Re-distribution from `distributed` is allowed and deliberate: site teams do
 * re-issue after a correction, and the report filer supersedes the prior version
 * and returns a new one.
 */
export async function distributeSiteFormAction(
  formId: string,
  projectId: string,
): Promise<
  | { error: string; reportId?: undefined; version?: undefined; warning?: undefined }
  | { error?: undefined; reportId: string; version: number; warning?: string }
> {
  if (!uuid.safeParse(formId).success || !uuid.safeParse(projectId).success) {
    return { error: 'Invalid id' }
  }

  // Distribution is a management action: it puts a record in front of the whole
  // project team. Capture roles (incl. contractor) deliberately cannot do it.
  const guard = await guardProject(projectId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const belongs = await guardFormBelongsToProject(formId, projectId)
  if (!belongs.ok) return { error: belongs.error }

  if (!DISTRIBUTABLE_STATUSES.has(belongs.status)) {
    if (belongs.status === 'draft') {
      return {
        error:
          'This form is still a draft. Submit it first — a draft has not passed the safe-isolation gates and must not go to the project team.',
      }
    }
    if (belongs.status === 'void') {
      return { error: 'This form has been voided and cannot be distributed.' }
    }
    return { error: `This form is ${belongs.status} and cannot be distributed.` }
  }

  // File the report first. Nothing is stamped or announced if this fails.
  const filed = await generateAndFileSiteFormReport(formId, projectId)
  if ('error' in filed) return { error: filed.error }

  const service = createServiceClient() as unknown as AnyClient
  const { error: stampError } = await service
    .schema('field')
    .from('site_forms')
    .update({
      status: 'distributed',
      distributed_by: guard.userId,
      distributed_at: new Date().toISOString(),
      report_id: filed.reportId,
    })
    .eq('id', formId)
    .eq('project_id', projectId)

  if (stampError) {
    // The report exists and is valid; only the stamp failed. Surface it rather
    // than announcing a distribution the DB does not record.
    console.error('[distributeSiteFormAction] stamp failed', stampError)
    return {
      error: `Report issued but the form could not be marked distributed: ${msg(
        stampError,
        'unknown error',
      )}`,
    }
  }

  // Roster bell + email. notifySiteFormDistributed never throws, but the try
  // here makes the "distribution still stands" contract explicit at the call
  // site rather than relying on the callee's discipline.
  let warning: string | undefined
  try {
    await notifySiteFormDistributed({ formId, projectId, actorId: guard.userId })
  } catch (e) {
    console.error('[distributeSiteFormAction] notify failed', e)
    warning =
      'The form was distributed and the report filed, but the team notification could not be sent.'
  }

  revalidatePath(`/projects/${projectId}/forms`)
  revalidatePath(`/projects/${projectId}/forms/${formId}`)

  return { reportId: filed.reportId, version: filed.version, ...(warning ? { warning } : {}) }
}
