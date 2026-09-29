// Node-only: renderToBuffer is unavailable in the browser build.
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import type { ResolvedBranding } from '@/lib/reports/branding'
import type { ProposalSnapshot } from '@esite/shared/solar-reports'
import { ProposalDocument } from './proposal-document'

export async function renderProposalPdf(snapshot: ProposalSnapshot, branding: ResolvedBranding, opts: { preview: boolean }): Promise<Buffer> {
  const el = React.createElement(ProposalDocument, { snapshot, branding, preview: opts.preview }) as React.ReactElement<DocumentProps>
  return renderToBuffer(el)
}
