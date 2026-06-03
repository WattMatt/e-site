import { describe, it, expect } from 'vitest'
import { resolveBranding } from './branding'

const FALLBACK_ACCENT = '#E69500'

// Minimal 1x1 transparent PNG data URI — used wherever a logo src is required.
const DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('resolveBranding — accent precedence', () => {
  it('uses project accent when present', () => {
    const result = resolveBranding({
      org: { name: 'WM', accent: '#111111' },
      project: { name: 'KING', accent: '#ABCDEF' },
      title: 'Test',
      kicker: 'KICKER',
      date: '2026-06-03',
    })
    expect(result.accent).toBe('#ABCDEF')
  })

  it('falls back to org accent when project accent is null', () => {
    const result = resolveBranding({
      org: { name: 'WM', accent: '#222222' },
      project: { name: 'KING', accent: null },
      title: 'Test',
      kicker: 'KICKER',
      date: '2026-06-03',
    })
    expect(result.accent).toBe('#222222')
  })

  it('falls back to org accent when project accent is undefined', () => {
    const result = resolveBranding({
      org: { name: 'WM', accent: '#333333' },
      project: { name: 'KING' },
      title: 'Test',
      kicker: 'KICKER',
      date: '2026-06-03',
    })
    expect(result.accent).toBe('#333333')
  })

  it('falls back to default #E69500 when both org and project accents are absent', () => {
    const result = resolveBranding({
      org: { name: 'WM' },
      project: { name: 'KING' },
      title: 'Test',
      kicker: 'KICKER',
      date: '2026-06-03',
    })
    expect(result.accent).toBe(FALLBACK_ACCENT)
  })
})

describe('resolveBranding — issuer', () => {
  it('uses org logoSrc when provided', () => {
    const result = resolveBranding({
      org: { name: 'WM', logoSrc: DATA_URI },
      project: { name: 'KING' },
      title: 'Test',
      kicker: 'KICKER',
      date: '2026-06-03',
    })
    expect(result.issuer.logoSrc).toBe(DATA_URI)
    expect(result.issuer.wordmark).toBeUndefined()
  })

  it('falls back to wordmark (org name) when org logoSrc is null', () => {
    const result = resolveBranding({
      org: { name: 'Watson Mattheus', logoSrc: null },
      project: { name: 'KING' },
      title: 'Test',
      kicker: 'KICKER',
      date: '2026-06-03',
    })
    expect(result.issuer.logoSrc).toBeUndefined()
    expect(result.issuer.wordmark).toBe('Watson Mattheus')
  })

  it('falls back to wordmark when org logoSrc is undefined', () => {
    const result = resolveBranding({
      org: { name: 'Watson Mattheus' },
      project: { name: 'KING' },
      title: 'Test',
      kicker: 'KICKER',
      date: '2026-06-03',
    })
    expect(result.issuer.logoSrc).toBeUndefined()
    expect(result.issuer.wordmark).toBe('Watson Mattheus')
  })
})

describe('resolveBranding — parties strip', () => {
  it('includes all parties with valid logoSrc', () => {
    const result = resolveBranding({
      org: { name: 'WM' },
      project: {
        name: 'KING',
        clientLogoSrc: DATA_URI,
        projectMarkSrc: DATA_URI,
      },
      contractor: { name: 'ABC Elec', logoSrc: DATA_URI },
      title: 'Test',
      kicker: 'KICKER',
      date: '2026-06-03',
    })
    expect(result.parties).toHaveLength(3)
    expect(result.parties[0].label).toBe('Prepared for')
    expect(result.parties[1].label).toBe('Project')
    expect(result.parties[2].label).toBe('Contractor')
  })

  it('excludes parties whose logoSrc is null', () => {
    const result = resolveBranding({
      org: { name: 'WM' },
      project: {
        name: 'KING',
        clientLogoSrc: null,
        projectMarkSrc: DATA_URI,
      },
      contractor: { name: 'ABC Elec', logoSrc: null },
      title: 'Test',
      kicker: 'KICKER',
      date: '2026-06-03',
    })
    expect(result.parties).toHaveLength(1)
    expect(result.parties[0].label).toBe('Project')
  })

  it('returns an empty parties array when all logos are absent', () => {
    const result = resolveBranding({
      org: { name: 'WM' },
      project: { name: 'KING' },
      title: 'Test',
      kicker: 'KICKER',
      date: '2026-06-03',
    })
    expect(result.parties).toHaveLength(0)
  })
})

describe('resolveBranding — text fields', () => {
  it('builds projectLine from project name', () => {
    const result = resolveBranding({
      org: { name: 'WM' },
      project: { name: 'Kingswalk Mall', subtitle: 'Phase 2' },
      title: 'Electrical Inspection',
      kicker: 'INSPECTION',
      date: '2026-06-03',
    })
    expect(result.projectLine).toContain('Kingswalk Mall')
    expect(result.projectLine).toContain('Phase 2')
    expect(result.title).toBe('Electrical Inspection')
    expect(result.kicker).toBe('INSPECTION')
  })

  it('builds projectLine without subtitle when absent', () => {
    const result = resolveBranding({
      org: { name: 'WM' },
      project: { name: 'Kingswalk Mall' },
      title: 'Test',
      kicker: 'KICKER',
      date: '2026-06-03',
    })
    expect(result.projectLine).toBe('Kingswalk Mall')
  })

  it('includes date in footerStamp', () => {
    const result = resolveBranding({
      org: { name: 'WM' },
      project: { name: 'KING' },
      title: 'Test',
      kicker: 'KICKER',
      date: '2026-06-03',
    })
    expect(result.footerStamp).toContain('2026-06-03')
  })
})
