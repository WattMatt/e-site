import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { BrandingPreviewDocument } from './branding-preview'
import type { ResolvedBranding } from './branding'

/**
 * Render a branded PDF preview cover to a Node.js Buffer.
 * Must be called in a Node runtime (not browser / edge).
 */
export async function renderBrandingPreview(
  resolved: ResolvedBranding,
): Promise<Buffer> {
  // Cast is needed because React.createElement returns FunctionComponentElement
  // but renderToBuffer expects ReactElement<DocumentProps>.
  const element = React.createElement(
    BrandingPreviewDocument,
    { resolved },
  ) as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}
