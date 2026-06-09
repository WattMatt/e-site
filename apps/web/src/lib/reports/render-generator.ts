// Node-only: renderToBuffer is not available in the browser build.
// The `browser` package.json field redirects jsdom to a stub that throws, so
// tests for this file must use `// @vitest-environment node`.
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { GeneratorReportDocument } from './generator-report'
import type { GeneratorReportData } from './generator-report-data'
import type { ResolvedBranding } from './branding'

/**
 * Render a Generator Cost Recovery Report PDF to a Node.js Buffer.
 * Must be called in a Node runtime (not browser / edge).
 */
export async function renderGeneratorReport(
  data: GeneratorReportData,
  branding: ResolvedBranding,
): Promise<Buffer> {
  // Cast is needed because React.createElement returns FunctionComponentElement
  // but renderToBuffer expects ReactElement<DocumentProps>.
  const element = React.createElement(
    GeneratorReportDocument,
    { data, branding },
  ) as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}
