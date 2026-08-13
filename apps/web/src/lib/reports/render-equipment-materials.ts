// Node-only: renderToBuffer is unavailable in the browser build.
// Tests for this file must use `// @vitest-environment node`.
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { EquipmentMaterialsReportDocument } from './equipment-materials-report'
import type { EquipmentMaterialsReportData } from './equipment-materials-report-data'
import type { ResolvedBranding } from './branding'

export async function renderEquipmentMaterialsReport(
  data: EquipmentMaterialsReportData,
  branding: ResolvedBranding,
): Promise<Buffer> {
  const element = React.createElement(
    EquipmentMaterialsReportDocument,
    { data, branding },
  ) as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}
