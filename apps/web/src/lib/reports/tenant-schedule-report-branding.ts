import type { BrandingInput } from './branding'
import type { TenantScheduleReportData } from './tenant-schedule-report-data'

export function buildTenantScheduleBrandingInput(data: TenantScheduleReportData, date: string): BrandingInput {
  const b = data.brandingInput
  return {
    org: { name: b.orgName, logoSrc: b.orgLogoDataUri ?? undefined, accent: b.orgAccent },
    project: {
      name: data.projectName,
      clientLogoSrc: b.clientLogoDataUri ?? undefined,
      projectMarkSrc: b.projectMarkDataUri ?? undefined,
      accent: b.projectAccent,
      subtitle: b.projectSubtitle || undefined,
    },
    contractor: null,
    title: 'Tenant Schedule Report',
    kicker: 'TENANT SCHEDULE',
    date,
  }
}
