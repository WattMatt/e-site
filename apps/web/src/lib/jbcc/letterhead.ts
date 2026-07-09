// apps/web/src/lib/jbcc/letterhead.ts
//
// Server-only resolver that turns an organisation's stored branding into the
// letterhead inputs used by both the .docx compositor (docx-letterhead) and
// the on-screen HTML preview (docx-preview). One place reads the org row +
// downloads the logo; both output shapes are derived from it.

import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import type { LetterheadBranding } from '@esite/shared/docx-letterhead'
import type { LetterheadHtmlBranding } from '@esite/shared/docx-preview'

const LOGO_BUCKET = 'report-logos'

export interface ResolvedLetterhead {
  companyName: string
  addressLines: string[]
  registrationNo: string | null
  vatNo: string | null
  phone: string | null
  website: string | null
  accentColorHex: string | null
  signatoryName: string | null
  signatoryTitle: string | null
  logoBytes: Uint8Array | null
  logoContentType: 'image/png' | 'image/jpeg' | null
  logoDataUri: string | null
}

interface OrgRow {
  name: string
  address: string | null
  city: string | null
  province: string | null
  registration_number: string | null
  registration_no: string | null
  vat_number: string | null
  phone: string | null
  website: string | null
  report_accent_color: string | null
  signatory_name: string | null
  signatory_title: string | null
  logo_url: string | null
}

function contentTypeFor(path: string, blobType?: string): 'image/png' | 'image/jpeg' | null {
  const p = path.toLowerCase()
  if (p.endsWith('.png') || blobType === 'image/png') return 'image/png'
  if (p.endsWith('.jpg') || p.endsWith('.jpeg') || blobType === 'image/jpeg') return 'image/jpeg'
  return null
}

/**
 * Resolve the org's letterhead branding. Uses the service client (the caller
 * must already have gated on role/org — this only runs after that). Returns
 * null if the org can't be read.
 */
export async function resolveOrgLetterhead(orgId: string): Promise<ResolvedLetterhead | null> {
  const service = createServiceClient()
  // Cast through `any`: several branding columns (report_accent_color,
  // signatory_name/title) are absent from the stale generated types — the
  // codebase's established pattern for gen-types blind spots.
  const { data, error } = await (service as any)
    .from('organisations')
    .select(
      'name, address, city, province, registration_number, registration_no, vat_number, phone, website, report_accent_color, signatory_name, signatory_title, logo_url',
    )
    .eq('id', orgId)
    .maybeSingle()
  if (error || !data) return null
  const org = data as OrgRow

  let logoBytes: Uint8Array | null = null
  let logoContentType: 'image/png' | 'image/jpeg' | null = null
  let logoDataUri: string | null = null

  if (org.logo_url) {
    try {
      const { data: blob } = await service.storage.from(LOGO_BUCKET).download(org.logo_url)
      if (blob) {
        const ct = contentTypeFor(org.logo_url, blob.type)
        if (ct) {
          const bytes = new Uint8Array(await blob.arrayBuffer())
          // Guard against absurd images (5 MB cap for a letterhead logo).
          if (bytes.length > 0 && bytes.length <= 5 * 1024 * 1024) {
            logoBytes = bytes
            logoContentType = ct
            logoDataUri = `data:${ct};base64,${Buffer.from(bytes).toString('base64')}`
          }
        }
      }
    } catch {
      // Logo is optional — a missing/broken logo must never fail generation.
    }
  }

  const addressLines = [org.address, [org.city, org.province].filter(Boolean).join(', ')]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)

  return {
    companyName: org.name,
    addressLines,
    registrationNo: org.registration_number || org.registration_no || null,
    vatNo: org.vat_number || null,
    phone: org.phone || null,
    website: org.website || null,
    accentColorHex: org.report_accent_color || null,
    signatoryName: org.signatory_name || null,
    signatoryTitle: org.signatory_title || null,
    logoBytes,
    logoContentType,
    logoDataUri,
  }
}

export function toDocxBranding(
  lh: ResolvedLetterhead,
  documentRef: string | null,
): LetterheadBranding {
  return {
    companyName: lh.companyName,
    addressLines: lh.addressLines,
    registrationNo: lh.registrationNo,
    vatNo: lh.vatNo,
    phone: lh.phone,
    website: lh.website,
    accentColorHex: lh.accentColorHex,
    documentRef,
    logo:
      lh.logoBytes && lh.logoContentType
        ? { data: lh.logoBytes, contentType: lh.logoContentType }
        : null,
  }
}

export function toHtmlBranding(
  lh: ResolvedLetterhead,
  documentRef: string | null,
): LetterheadHtmlBranding {
  return {
    companyName: lh.companyName,
    addressLines: lh.addressLines,
    registrationNo: lh.registrationNo,
    vatNo: lh.vatNo,
    phone: lh.phone,
    website: lh.website,
    accentColorHex: lh.accentColorHex,
    documentRef,
    logoDataUri: lh.logoDataUri,
  }
}
