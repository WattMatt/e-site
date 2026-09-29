// Node-only: renderToBuffer is unavailable in the browser build. Tests use `// @vitest-environment node`.
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import type { ResolvedBranding } from '@/lib/reports/branding'
import { MonthlyReportDocument, type MonthlyReportModelView } from './monthly-document'

export async function renderMonthlyReport(model: MonthlyReportModelView, branding: ResolvedBranding): Promise<Buffer> {
  const el = React.createElement(MonthlyReportDocument, { model, branding }) as React.ReactElement<DocumentProps>
  return renderToBuffer(el)
}
