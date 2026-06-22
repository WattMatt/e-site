import { describe, it, expect } from 'vitest'
import { brandedTemplate } from './branded.ts'

describe('brandedTemplate', () => {
  const base = {
    heading: 'Accept your invitation',
    bodyHtml: '<p>You were invited.</p>',
    ctaLabel: 'Accept invitation & set password',
    ctaHref: 'https://app.e-site.live/accept-invite?token_hash=abc&type=invite',
    expiryLabel: 'This link expires in 60 minutes.',
    fallbackLink: 'https://app.e-site.live/accept-invite?token_hash=abc&type=invite',
    org: { name: 'Watson Mattheus', logoSrc: 'data:image/png;base64,AAAA', accent: '#E69500' },
  }

  it('renders the org logo when present and the accent on the CTA', () => {
    const html = brandedTemplate(base)
    expect(html).toContain('data:image/png;base64,AAAA')
    expect(html).toContain('#E69500')
    expect(html).toContain('via E-Site')
  })

  it('falls back to the org name as a wordmark when no logo', () => {
    const html = brandedTemplate({ ...base, org: { name: 'Bob Building', logoSrc: null, accent: '#123456' } })
    expect(html).toContain('Bob Building')
    expect(html).not.toContain('<img') // no logo image rendered
    expect(html).toContain('#123456')
  })

  it('renders CTA, expiry and a paste-able fallback link', () => {
    const html = brandedTemplate(base)
    expect(html).toContain('Accept invitation &amp; set password')
    expect(html).toContain('This link expires in 60 minutes.')
    // fallback link appears as visible, copyable text
    expect(html).toContain('https://app.e-site.live/accept-invite?token_hash=abc&amp;type=invite')
  })

  it('escapes org name to prevent HTML injection', () => {
    const html = brandedTemplate({ ...base, org: { name: '<script>x</script>', logoSrc: null, accent: '#E69500' } })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('uses platform-only header when org is null (account-level mail)', () => {
    const html = brandedTemplate({ ...base, org: null, ctaLabel: 'Reset password', ctaHref: 'x', fallbackLink: 'x' })
    expect(html).toContain('E-Site')
    expect(html).not.toContain('via E-Site') // no org → no co-brand line
  })
})
