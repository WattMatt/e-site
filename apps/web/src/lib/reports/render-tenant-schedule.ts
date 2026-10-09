// Node-only: renderToBuffer is unavailable in the browser build.
// Tests for this file must use `// @vitest-environment node`.
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { TenantScheduleReportDocument } from './tenant-schedule-report'
import type { TenantScheduleReportData } from './tenant-schedule-report-data'
import type { ResolvedBranding } from './branding'
import { appendStatusPlansToReport } from '@/lib/status-plans/appendix'
import { planTitle } from '@/lib/status-plans/render-plan-page'
import type { ReportAppendix } from '@/lib/status-plans/report-appendix'

export async function renderTenantScheduleReport(
  data: TenantScheduleReportData,
  branding: ResolvedBranding,
  appendix?: ReportAppendix | null,
): Promise<Buffer> {
  const element = React.createElement(
    TenantScheduleReportDocument,
    { data, branding },
  ) as React.ReactElement<DocumentProps>
  const buf = await renderToBuffer(element)
  if (!appendix || (appendix.load.inputs.length === 0 && appendix.load.omitted.length === 0)) return buf
  try {
    return Buffer.from(await appendStatusPlansToReport(new Uint8Array(buf), appendix.load, appendix.generatedOn))
  } catch (err) {
    // Per-plan failures are already handled inside the appendix; this is the unexpected case. The
    // report still ships, with every plan listed as not included.
    console.error('[tenant-schedule-report] status plan appendix failed', err)
    const fallback = {
      inputs: [],
      omitted: [
        ...appendix.load.omitted,
        ...appendix.load.inputs.map((i) => ({ title: planTitle(i.planName, i.purpose, i.pageIndex), reason: 'the plan could not be drawn' })),
      ],
    }
    try {
      return Buffer.from(await appendStatusPlansToReport(new Uint8Array(buf), fallback, appendix.generatedOn))
    } catch (err2) {
      console.error('[tenant-schedule-report] status plan divider failed; report ships without it', err2)
      return buf
    }
  }
}
