/**
 * buildGcrBrandingInput — single source of truth for the generator report's
 * BrandingInput (org logo/accent, client logo, project mark, title, kicker).
 * Used by both the no-save preview route and the save-a-revision route so the
 * two can never drift apart on branding.
 */

import type { BrandingInput } from './branding'
import type { GeneratorReportData } from './generator-report-data'

export function buildGcrBrandingInput(
  data: GeneratorReportData,
  date: string,
): BrandingInput {
  const { brandingInput } = data
  return {
    org: {
      name: brandingInput.orgName,
      logoSrc: brandingInput.orgLogoDataUri ?? undefined,
      accent: brandingInput.orgAccent,
    },
    project: {
      name: data.projectName,
      clientLogoSrc: brandingInput.clientLogoDataUri ?? undefined,
      projectMarkSrc: brandingInput.projectMarkDataUri ?? undefined,
      accent: brandingInput.projectAccent,
      subtitle: brandingInput.projectSubtitle || undefined,
    },
    contractor: null,
    title: 'Generator Cost-Recovery Report',
    kicker: 'STANDBY GENERATOR · COST RECOVERY',
    date,
  }
}
