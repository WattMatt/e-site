import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { SiteFormReportDocument } from './site-form-report'
import type { SiteFormReportData } from './site-form-report-data'

/**
 * Render a Site Form (termination & making-safe) record to a PDF Buffer.
 *
 * Node runtime only — the browser build of @react-pdf/renderer stubs out
 * renderToBuffer, so any importer (route handler, server action, test) must run
 * in Node. Tests need `// @vitest-environment node`.
 */
export async function renderSiteFormReport(data: SiteFormReportData): Promise<Buffer> {
  // Cast: React.createElement returns FunctionComponentElement, while
  // renderToBuffer's signature wants ReactElement<DocumentProps>.
  const element = React.createElement(
    SiteFormReportDocument,
    { data },
  ) as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}
