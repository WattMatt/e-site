// No 'use client' — server-side PDF rendering only.
import React from 'react'
import { Document, Page } from '@react-pdf/renderer'
import { Cover, Watermark, PreviewBody, pageStyles } from './components'
import type { ResolvedBranding } from './branding'

interface BrandingPreviewDocumentProps {
  resolved: ResolvedBranding
}

export function BrandingPreviewDocument({
  resolved,
}: BrandingPreviewDocumentProps) {
  return (
    <Document title={resolved.title} producer="e-site.live">
      <Page size="A4" style={pageStyles.page}>
        <Cover resolved={resolved} />
        <Watermark />
        <PreviewBody />
      </Page>
    </Document>
  )
}
