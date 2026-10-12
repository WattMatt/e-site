// Node-only: renderToBuffer is unavailable in the browser build.
// Tests for this file must use `// @vitest-environment node`.
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { TenantScheduleReportDocument } from './tenant-schedule-report'
import type { TenantScheduleReportData } from './tenant-schedule-report-data'
import type { ResolvedBranding } from './branding'
import { appendStatusPlansToReportDetailed } from '@/lib/status-plans/appendix'
import type { PlanOmission } from '@/lib/status-plans/plan-render-data'
import { MAX_HANDOFF_PDF_BYTES } from './pdf-limits'
import { planTitle } from '@/lib/status-plans/render-plan-page'
import type { ReportAppendix } from '@/lib/status-plans/report-appendix'

export interface AppendixOutcome { appended: number; notIncluded: PlanOmission[] }
export interface RenderOptions {
  /** Final-size ceiling (default 48 MiB, under the reports bucket's 50 MiB). Injected small in tests. */
  maxBytes?: number
  /** Called with what the appendix ACTUALLY holds (after embedding, after any size fallback). Not called without an appendix. */
  onOutcome?: (o: AppendixOutcome) => void
}

export async function renderTenantScheduleReport(
  data: TenantScheduleReportData,
  branding: ResolvedBranding,
  appendix?: ReportAppendix | null,
  opts: RenderOptions = {},
): Promise<Buffer> {
  const maxBytes = opts.maxBytes ?? MAX_HANDOFF_PDF_BYTES
  const element = React.createElement(
    TenantScheduleReportDocument,
    { data, branding },
  ) as React.ReactElement<DocumentProps>
  const buf = await renderToBuffer(element)
  if (!appendix || (appendix.load.inputs.length === 0 && appendix.load.omitted.length === 0)) return buf

  // Every plan listed as not included: the fallback for an unexpected failure and for a PDF that
  // would be too big to store. The report itself still ships.
  const withoutPlans = async (reason: string): Promise<Buffer> => {
    const fallback = {
      inputs: [],
      omitted: [
        ...appendix.load.omitted,
        ...appendix.load.inputs.map((i) => ({ title: planTitle(i.planName, i.purpose, i.pageIndex), reason })),
      ],
    }
    try {
      const r = await appendStatusPlansToReportDetailed(new Uint8Array(buf), fallback, appendix.generatedOn)
      opts.onOutcome?.({ appended: 0, notIncluded: r.notIncluded })
      return Buffer.from(r.bytes)
    } catch (err2) {
      console.error('[tenant-schedule-report] status plan divider failed; report ships without it', err2)
      opts.onOutcome?.({ appended: 0, notIncluded: fallback.omitted })
      return buf
    }
  }

  try {
    const r = await appendStatusPlansToReportDetailed(new Uint8Array(buf), appendix.load, appendix.generatedOn)
    if (r.bytes.byteLength > maxBytes) {
      console.error('[tenant-schedule-report] report with status plans is too large; shipping it without the plans', r.bytes.byteLength)
      return withoutPlans('the plans made the report too large to save — export this plan from its page')
    }
    opts.onOutcome?.({ appended: r.appended, notIncluded: r.notIncluded })
    return Buffer.from(r.bytes)
  } catch (err) {
    // Per-plan failures are already handled inside the appendix; this is the unexpected case.
    console.error('[tenant-schedule-report] status plan appendix failed', err)
    return withoutPlans('the plan could not be drawn')
  }
}
