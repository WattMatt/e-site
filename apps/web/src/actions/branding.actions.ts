'use server'

/**
 * branding.actions.ts — write project branding fields (logo uploads + accent colour).
 *
 * Both actions resolve project → org, then gate on ORG_WRITE_ROLES via
 * requireEffectiveRole (honours per-project role overrides, migration 00107).
 * Writes are done through the service client because the RLS client's session
 * cookie cannot perform storage uploads.
 *
 * File transport: FormData (standard Next.js server-action file transport; matches
 * the existing supplier.actions.ts pattern across this codebase). The caller
 * appends the file under the key "file" — e.g. formData.append('file', blob).
 */

import { revalidatePath } from 'next/cache'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, ORG_WRITE_ROLES } from '@esite/shared'

// ─── Constants ───────────────────────────────────────────────────────────────

const LOGO_BUCKET = 'report-logos'
const HEX_RE = /^#[0-9A-Fa-f]{6}$/

const SETTINGS_PATH = (projectId: string) => `/projects/${projectId}/settings/general`

// ─── Internal guard ──────────────────────────────────────────────────────────

async function guardBrandingAccess(projectId: string): Promise<
  | { error: string; orgId?: undefined }
  | { error?: undefined; orgId: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const project = await projectService.getById(supabase as never, projectId)
  if (!project) return { error: 'Project not found' }

  const roleGate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!roleGate.ok) return { error: roleGate.error }

  return { orgId: project.organisation_id as string }
}

// ─── uploadProjectLogoAction ─────────────────────────────────────────────────

export type UploadLogoResult = { error: string } | { path: string }

/**
 * Upload a raster logo to `report-logos/{org_id}/{project_id}/{slot}-logo.{ext}`
 * and set the corresponding `projects.projects` column:
 *   - slot='client'  → client_logo_url
 *   - slot='project' → project_logo_url
 *
 * Caller passes a FormData with the file under the key "file".
 */
export async function uploadProjectLogoAction(
  projectId: string,
  slot: 'client' | 'project',
  formData: FormData,
): Promise<UploadLogoResult> {
  // ── Access gate ──
  const guard = await guardBrandingAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  // ── Validate file ──
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { error: 'No file provided' }
  }
  const fileObj: File = file
  const originalName = fileObj.name || 'logo'
  const ext = originalName.includes('.') ? originalName.split('.').pop()! : 'png'

  // ── Upload ──
  const storagePath = `${guard.orgId}/${projectId}/${slot}-logo.${ext}`
  const service = createServiceClient()
  const { error: uploadError } = await service.storage
    .from(LOGO_BUCKET)
    .upload(storagePath, fileObj, {
      contentType: fileObj.type || 'image/png',
      upsert: true,
    })
  if (uploadError) return { error: `Upload failed: ${uploadError.message}` }

  // ── Update the projects row ──
  const column = slot === 'client' ? 'client_logo_url' : 'project_logo_url'
  const { error: dbError } = await (service as any)
    .schema('projects')
    .from('projects')
    .update({ [column]: storagePath })
    .eq('id', projectId)
  if (dbError) return { error: `DB update failed: ${dbError.message}` }

  revalidatePath(SETTINGS_PATH(projectId))
  return { path: storagePath }
}

// ─── updateProjectAccentAction ───────────────────────────────────────────────

export type UpdateAccentResult = { error: string } | { ok: true }

/**
 * Persist the branded accent colour for a project.
 * `hex` must be exactly `#RRGGBB` (6 hex digits, with `#`).
 */
export async function updateProjectAccentAction(
  projectId: string,
  hex: string,
): Promise<UpdateAccentResult> {
  // ── Validate before touching the DB / role gate ──
  if (!HEX_RE.test(hex)) {
    return { error: 'Invalid hex colour. Expected format: #RRGGBB (6 hex digits).' }
  }

  // ── Access gate ──
  const guard = await guardBrandingAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  // ── Update ──
  const service = createServiceClient()
  const { error: dbError } = await (service as any)
    .schema('projects')
    .from('projects')
    .update({ report_accent_color: hex })
    .eq('id', projectId)
  if (dbError) return { error: `DB update failed: ${dbError.message}` }

  revalidatePath(SETTINGS_PATH(projectId))
  return { ok: true }
}
