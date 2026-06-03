import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { InspectionReportDocument } from './inspection-report'
import type { InspectionReportData } from './inspection-report-data'
import type { ResolvedBranding } from './branding'

/**
 * Render an Inspection & Test Report PDF to a Node.js Buffer.
 * Must be called in a Node runtime (not browser / edge).
 */
export async function renderInspectionReport(
  data: InspectionReportData,
  branding: ResolvedBranding,
): Promise<Buffer> {
  // Cast is needed because React.createElement returns FunctionComponentElement
  // but renderToBuffer expects ReactElement<DocumentProps>.
  const element = React.createElement(
    InspectionReportDocument,
    { data, branding },
  ) as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}
