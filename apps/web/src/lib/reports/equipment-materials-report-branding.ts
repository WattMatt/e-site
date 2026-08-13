import type { BrandingInput } from './branding'
import type { EquipmentMaterialsReportData } from './equipment-materials-report-data'

export function buildEquipmentMaterialsBrandingInput(
  data: EquipmentMaterialsReportData,
  date: string,
): BrandingInput {
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
    title: 'Equipment & Materials Report',
    kicker: 'EQUIPMENT & MATERIALS',
    date,
  }
}
