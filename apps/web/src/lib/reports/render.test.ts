// @vitest-environment node
// Node environment is required: @react-pdf/renderer's browser build stubs out
// renderToBuffer (throws). The `browser` package.json field redirects jsdom
// to that stub, so we must opt into the Node environment for this file.

import { describe, it, expect } from 'vitest'
import { renderBrandingPreview } from './render'
import type { ResolvedBranding } from './branding'

// Minimal 1×1 transparent PNG — used for all logo srcs so there is zero
// network access during tests.
const DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const baseResolved: ResolvedBranding = {
  accent: '#E69500',
  issuer: { logoSrc: DATA_URI },
  parties: [],
  title: 'Electrical Inspection Report',
  kicker: 'ELECTRICAL INSPECTION',
  projectLine: 'Kingswalk Mall — Phase 2',
  footerStamp: 'Generated 2026-06-03 · e-site.live',
}

describe('renderBrandingPreview', () => {
  it('returns a Buffer that starts with the PDF magic bytes %PDF-', async () => {
    const buf = await renderBrandingPreview(baseResolved)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders without throwing when parties array is empty', async () => {
    const resolved: ResolvedBranding = { ...baseResolved, parties: [] }
    await expect(renderBrandingPreview(resolved)).resolves.toBeDefined()
  })

  it('renders without throwing when parties array has multiple entries', async () => {
    const resolved: ResolvedBranding = {
      ...baseResolved,
      parties: [
        { label: 'Prepared for', logoSrc: DATA_URI },
        { label: 'Project', logoSrc: DATA_URI },
        { label: 'Contractor', logoSrc: DATA_URI },
      ],
    }
    await expect(renderBrandingPreview(resolved)).resolves.toBeDefined()
  })

  it('renders when issuer has a wordmark instead of a logo', async () => {
    const resolved: ResolvedBranding = {
      ...baseResolved,
      issuer: { wordmark: 'Watson Mattheus Consulting' },
    }
    const buf = await renderBrandingPreview(resolved)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })
})
