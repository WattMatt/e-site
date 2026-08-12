import { describe, it, expect } from 'vitest'

import {
  renderBrandedEmail,
  escapeHtml,
  DEFAULT_ACCENT_COLOR,
  type BrandedEmailOptions,
} from './layout'

const opts: BrandedEmailOptions = {
  accentColor: '#22C55E',
  logoUrl: null,
  projectName: 'KINGSWALK',
  title: 'Site form distributed',
  contentHtml: '<p>Body copy.</p>',
  siteUrl: 'https://www.e-site.live',
}

describe('escapeHtml', () => {
  it('neutralises the HTML-significant characters', () => {
    expect(escapeHtml('<script>"x"&y</script>')).toBe(
      '&lt;script&gt;&quot;x&quot;&amp;y&lt;/script&gt;',
    )
  })
})

describe('renderBrandedEmail', () => {
  it('drives the accent colour through the header rule', () => {
    const html = renderBrandedEmail(opts)
    expect(html).toContain('#22C55E')
  })

  it('falls back to the default accent when the value is not a colour literal', () => {
    const html = renderBrandedEmail({ ...opts, accentColor: 'url(javascript:alert(1))' })
    expect(html).not.toContain('javascript:')
    expect(html).toContain(DEFAULT_ACCENT_COLOR)
  })

  it('renders the logo when given a signed URL', () => {
    const html = renderBrandedEmail({
      ...opts,
      logoUrl: 'https://cbskbnvvgcybmfikxgky.supabase.co/storage/v1/object/sign/logos/a.png?token=abc',
    })
    expect(html).toContain('<img ')
    expect(html).toContain('/storage/v1/object/sign/logos/a.png?token=abc')
  })

  it('omits the logo entirely when none is supplied', () => {
    expect(renderBrandedEmail(opts)).not.toContain('<img ')
  })

  it('NEVER emits a data: URI image, even when one is passed as the logo', () => {
    // Gmail and most webmail clients strip data: in <img src>, so an inlined
    // logo would render as a broken image. It must be dropped, not emitted.
    const html = renderBrandedEmail({
      ...opts,
      logoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
    })
    expect(html.toLowerCase()).not.toContain('data:image')
    expect(html).not.toContain('iVBORw0KGgo')
    expect(html).not.toContain('<img ')
  })

  it('drops a data: URI regardless of case or surrounding whitespace', () => {
    const html = renderBrandedEmail({
      ...opts,
      logoUrl: '  DATA:image/png;base64,iVBORw0KGgo=  ',
    })
    expect(html.toLowerCase()).not.toContain('data:image')
    expect(html).not.toContain('<img ')
  })

  it('escapes the project name, title and footer note', () => {
    const html = renderBrandedEmail({
      ...opts,
      projectName: '<script>alert("p")</script>',
      title: '<script>alert("t")</script>',
      footerNote: '<script>alert("f")</script>',
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('alert("p")')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders the footer note when supplied and omits the block otherwise', () => {
    const withNote = renderBrandedEmail({ ...opts, footerNote: 'Not a Certificate of Compliance.' })
    expect(withNote).toContain('Not a Certificate of Compliance.')
    expect(renderBrandedEmail(opts)).not.toContain('Not a Certificate of Compliance.')
  })

  it('passes caller content through unescaped and keeps the card at 560px', () => {
    const html = renderBrandedEmail({ ...opts, contentHtml: '<p id="marker">Body</p>' })
    expect(html).toContain('<p id="marker">Body</p>')
    expect(html).toContain('max-width:560px')
  })

  it('keeps the shared dark-card palette', () => {
    const html = renderBrandedEmail(opts)
    expect(html).toContain('#0F172A')
    expect(html).toContain('#1E293B')
    expect(html).toContain('#334155')
    expect(html).toContain('#E2E8F0')
  })

  it('links the footer wordmark at the site URL', () => {
    expect(renderBrandedEmail(opts)).toContain('href="https://www.e-site.live"')
  })
})
