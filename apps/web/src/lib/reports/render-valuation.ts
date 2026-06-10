import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { ValuationReportDocument } from './valuation-report'
import type { ValuationReportData } from './valuation-report-data'

/**
 * Render a Payment Certificate PDF to a Node.js Buffer.
 * Must be called in a Node runtime (not browser / edge) — the browser build of
 * @react-pdf/renderer stubs out renderToBuffer.
 */
export async function renderValuationReport(
  data: ValuationReportData,
): Promise<Buffer> {
  // Cast is needed because React.createElement returns FunctionComponentElement
  // but renderToBuffer expects ReactElement<DocumentProps>.
  const element = React.createElement(
    ValuationReportDocument,
    { data },
  ) as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}
