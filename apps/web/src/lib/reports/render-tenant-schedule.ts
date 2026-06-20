// Node-only: renderToBuffer is unavailable in the browser build.
// Tests for this file must use `// @vitest-environment node`.
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { TenantScheduleReportDocument } from './tenant-schedule-report'
import type { TenantScheduleReportData } from './tenant-schedule-report-data'
import type { ResolvedBranding } from './branding'

export async function renderTenantScheduleReport(
  data: TenantScheduleReportData,
  branding: ResolvedBranding,
): Promise<Buffer> {
  const element = React.createElement(
    TenantScheduleReportDocument,
    { data, branding },
  ) as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}
