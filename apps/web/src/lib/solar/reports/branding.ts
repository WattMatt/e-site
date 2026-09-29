/**
 * Solar report branding (spec §9.2): the org's (or project's) logo and accent, else a NEUTRAL
 * template — the org name as wordmark and a slate accent — plus a warning. Never the E-Site
 * amber that lib/reports/theme.ts uses as its own default. Pure: the loader is branding-loader.ts.
 */
import { resolveBranding, type ResolvedBranding } from '@/lib/reports/branding'
import { pdfText } from './pdf-text'

export const NEUTRAL_ACCENT = '#334155'
const HEX = /^#[0-9a-f]{6}$/i
export const NO_BRANDING_WARNING =
  'Your organisation has no report branding, so a neutral template was used. Add a logo and an accent colour under Settings, Branding.'

export interface SolarBrandingData {
  orgName: string
  orgLogoDataUri: string | null
  orgAccent: string | null
  projectAccent: string | null
  clientLogoDataUri: string | null
  projectName: string
}

export function solarBranding(
  d: SolarBrandingData,
  meta: { title: string; kicker: string; date: string },
): { branding: ResolvedBranding; warning: string | null } {
  const resolved = resolveBranding({
    org: { name: d.orgName, logoSrc: d.orgLogoDataUri, accent: d.orgAccent },
    project: { name: d.projectName, clientLogoSrc: d.clientLogoDataUri, accent: d.projectAccent },
    contractor: null,
    title: meta.title, kicker: meta.kicker, date: meta.date,
  })
  // resolveBranding falls back to the E-Site amber, so the accent is chosen here: the first VALID
  // supplied colour (project before org), else neutral.
  const chosen = [d.projectAccent, d.orgAccent].map((a) => a?.trim() ?? '').find((a) => HEX.test(a)) ?? null
  const accentIsSupplied = chosen !== null
  const branding: ResolvedBranding = {
    ...resolved,
    accent: chosen ?? NEUTRAL_ACCENT,
    issuer: resolved.issuer.wordmark !== undefined ? { wordmark: pdfText(resolved.issuer.wordmark) } : resolved.issuer,
    title: pdfText(resolved.title),
    kicker: pdfText(resolved.kicker),
    projectLine: pdfText(resolved.projectLine),
    footerStamp: pdfText(resolved.footerStamp),
  }
  const warning = !d.orgLogoDataUri && !accentIsSupplied ? NO_BRANDING_WARNING : null
  return { branding, warning }
}
