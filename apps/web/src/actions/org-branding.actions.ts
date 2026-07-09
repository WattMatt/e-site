'use server'

/**
 * org-branding.actions.ts — write ORGANISATION branding (letterhead) fields.
 *
 * These populate the org-level letterhead used on generated JBCC notice
 * letters + reports (the compositor reads the organisations row directly).
 *
 * All three actions gate on OWNER_ADMIN of the caller's *primary* org
 * (getOrgContext + requireRole). Writes go through the service client because
 * the RLS cookie client cannot perform storage uploads — same rationale as the
 * per-project branding.actions.ts.
 *
 * NB: signatory_name / signatory_title / report_accent_color live in the DB but
 * are not yet in the generated `organisations` types (gen-types can't see the
 * newer columns), so the reads/writes here go through an `as any` client — the
 * same cast pattern branding.actions.ts uses for the projects schema.
 *
 * Logo convention (must match the compositor): object path
 *   report-logos/{orgId}/org-logo.{ext}
 * with organisations.logo_url set to that path. Logo must be PNG or JPEG.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { getOrgContext } from '@/lib/auth-org'
import { OWNER_ADMIN } from '@esite/shared'

// ─── Constants ───────────────────────────────────────────────────────────────

const LOGO_BUCKET = 'report-logos'
const HEX_RE = /^#[0-9A-Fa-f]{6}$/
const MAX_LOGO_BYTES = 5 * 1024 * 1024 // 5 MB

/** Allowed logo mime types → the extension we persist them under. */
const ALLOWED_LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
}

const SETTINGS_PATH = '/settings/branding'

// ─── Internal guard ──────────────────────────────────────────────────────────

/**
 * Resolve the caller's primary org and confirm they hold owner/admin on it.
 * Org branding is an org-level surface, so we gate on OWNER_ADMIN (not the
 * per-project ORG_WRITE_ROLES).
 */
async function guardOrgBranding(): Promise<
  | { error: string; orgId?: undefined }
  | { error?: undefined; orgId: string }
> {
  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'No organisation found' }

  const roleGate = await requireRole(supabase, ctx.organisationId, OWNER_ADMIN)
  if (!roleGate.ok) return { error: roleGate.error }

  return { orgId: ctx.organisationId }
}

// ─── uploadOrgLogoAction ─────────────────────────────────────────────────────

export type OrgBrandingResult = { error: string } | { ok: true }

/**
 * Upload the org letterhead logo to `report-logos/{orgId}/org-logo.{ext}`
 * (upsert) and set `organisations.logo_url` to that path.
 *
 * Caller passes a FormData with the file under the key "file". The file must
 * be a PNG or JPEG of at most 5 MB.
 */
export async function uploadOrgLogoAction(
  formData: FormData,
): Promise<OrgBrandingResult> {
  // ── Access gate ──
  const guard = await guardOrgBranding()
  if (guard.error !== undefined) return { error: guard.error }

  // ── Validate file ──
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { error: 'No file provided' }
  }
  const ext = ALLOWED_LOGO_TYPES[file.type]
  if (!ext) {
    return { error: 'Logo must be a PNG or JPEG image.' }
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { error: 'Logo must be 5 MB or smaller.' }
  }

  // ── Upload ──
  const storagePath = `${guard.orgId}/org-logo.${ext}`
  const service = createServiceClient()
  const { error: uploadError } = await service.storage
    .from(LOGO_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: true,
    })
  if (uploadError) return { error: `Upload failed: ${uploadError.message}` }

  // ── Persist the path on the org row ──
  const { error: dbError } = await (service as any)
    .from('organisations')
    .update({ logo_url: storagePath })
    .eq('id', guard.orgId)
  if (dbError) return { error: `DB update failed: ${dbError.message}` }

  revalidatePath(SETTINGS_PATH)
  return { ok: true }
}

// ─── updateOrgBrandingAction ─────────────────────────────────────────────────

const orgBrandingSchema = z.object({
  name: z.string().trim().min(1, 'Organisation name is required').optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  province: z.string().trim().optional(),
  registration_number: z.string().trim().optional(),
  vat_number: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  website: z.string().trim().optional(),
  signatory_name: z.string().trim().optional(),
  signatory_title: z.string().trim().optional(),
  report_accent_color: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || HEX_RE.test(v), {
      message: 'Accent colour must be in #RRGGBB format.',
    }),
})

export type OrgBrandingInput = z.input<typeof orgBrandingSchema>

/**
 * Persist the org letterhead text fields + accent colour. Empty strings are
 * stored as NULL. `name` is only touched when a non-empty value is supplied.
 */
export async function updateOrgBrandingAction(
  input: OrgBrandingInput,
): Promise<OrgBrandingResult> {
  // ── Validate before touching the DB ──
  const parsed = orgBrandingSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const data = parsed.data

  // ── Access gate ──
  const guard = await guardOrgBranding()
  if (guard.error !== undefined) return { error: guard.error }

  // ── Build the update (empty → null; name only when provided) ──
  const update: Record<string, string | null> = {
    address: data.address || null,
    city: data.city || null,
    province: data.province || null,
    registration_number: data.registration_number || null,
    vat_number: data.vat_number || null,
    phone: data.phone || null,
    website: data.website || null,
    signatory_name: data.signatory_name || null,
    signatory_title: data.signatory_title || null,
    report_accent_color: data.report_accent_color || null,
  }
  if (data.name !== undefined) update.name = data.name

  const service = createServiceClient()
  const { error: dbError } = await (service as any)
    .from('organisations')
    .update(update)
    .eq('id', guard.orgId)
  if (dbError) return { error: `DB update failed: ${dbError.message}` }

  revalidatePath(SETTINGS_PATH)
  return { ok: true }
}

// ─── removeOrgLogoAction ─────────────────────────────────────────────────────

/**
 * Clear the org letterhead logo — removes the stored object (best-effort) and
 * nulls `organisations.logo_url`.
 */
export async function removeOrgLogoAction(): Promise<OrgBrandingResult> {
  // ── Access gate ──
  const guard = await guardOrgBranding()
  if (guard.error !== undefined) return { error: guard.error }

  const service = createServiceClient()

  // Best-effort delete of the stored object (path is on the org row).
  const { data: org } = await (service as any)
    .from('organisations')
    .select('logo_url')
    .eq('id', guard.orgId)
    .maybeSingle()
  const currentPath = (org as { logo_url?: string | null } | null)?.logo_url
  if (currentPath) {
    await service.storage.from(LOGO_BUCKET).remove([currentPath])
  }

  // ── Clear the column ──
  const { error: dbError } = await (service as any)
    .from('organisations')
    .update({ logo_url: null })
    .eq('id', guard.orgId)
  if (dbError) return { error: `DB update failed: ${dbError.message}` }

  revalidatePath(SETTINGS_PATH)
  return { ok: true }
}
