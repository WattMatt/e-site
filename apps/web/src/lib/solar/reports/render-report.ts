// Node-only: renderToBuffer is unavailable in the browser build. Tests use `// @vitest-environment node`.
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import type { ResolvedBranding } from '@/lib/reports/branding'
import type { SolarReportModel } from '@esite/shared/solar-reports'
import { SolarReportDocument } from './report-document'

export async function renderSolarReport(model: SolarReportModel, branding: ResolvedBranding): Promise<Buffer> {
  const el = React.createElement(SolarReportDocument, { model, branding }) as React.ReactElement<DocumentProps>
  return renderToBuffer(el)
}
