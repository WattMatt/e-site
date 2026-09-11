// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { safeReturnTo, DEFAULT_RETURN_TO, returnToForFeature } from './return-to'

/**
 * `return_to` travels through Paystack: it is written into transaction
 * metadata at initialize time and comes back inside the `transaction/verify`
 * response body, which the callback then feeds to `new URL(x, req.url)`.
 * `new URL('https://evil.test', 'https://www.e-site.live/x')` resolves to
 * evil.test — so an unvalidated value converts a cosmetic redirect bug into an
 * open redirect on an authenticated endpoint.
 *
 * These fixtures are the hostile set, not the happy set: if the validator were
 * deleted and replaced with `(v) => v`, every case below except the first
 * group would go red.
 */

describe('safeReturnTo — accepts only same-origin absolute paths', () => {
  it.each([
    ['/settings/billing', '/settings/billing'],
    ['/inspections', '/inspections'],
    ['/projects/abc-123/jbcc', '/projects/abc-123/jbcc'],
    ['/settings/billing?tab=invoices', '/settings/billing?tab=invoices'],
    ['/a/b/c#frag', '/a/b/c#frag'],
  ])('keeps %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected)
  })
})

describe('safeReturnTo — rejects everything that could leave the origin', () => {
  it.each([
    ['//evil.test/pwn', 'protocol-relative URL — new URL() treats this as a host'],
    ['///evil.test', 'triple slash, same trick'],
    ['https://evil.test', 'absolute https'],
    ['http://evil.test', 'absolute http'],
    ['HTTPS://evil.test', 'scheme is case-insensitive'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['JaVaScRiPt:alert(1)', 'mixed-case javascript scheme'],
    ['data:text/html,<script>', 'data scheme'],
    ['vbscript:msgbox', 'vbscript scheme'],
    ['\\\\evil.test/pwn', 'backslashes — some parsers normalise these to //'],
    ['/\\evil.test', 'slash-backslash'],
    ['\\/evil.test', 'backslash-slash'],
    ['settings/billing', 'relative, no leading slash'],
    ['', 'empty'],
    ['   ', 'whitespace'],
    ['/\tx', 'embedded tab — stripped by URL parsers before scheme detection'],
    ['/\nx', 'embedded newline'],
    ['/\rx', 'embedded carriage return'],
    ['/x\u0000y', 'embedded NUL'],
  ])('falls back for %s (%s)', (input) => {
    expect(safeReturnTo(input)).toBe(DEFAULT_RETURN_TO)
  })

  it.each([undefined, null, 42, {}, [], true])('falls back for the non-string %o', (input) => {
    expect(safeReturnTo(input as unknown as string)).toBe(DEFAULT_RETURN_TO)
  })

  it('honours an explicit fallback', () => {
    expect(safeReturnTo('https://evil.test', '/dashboard')).toBe('/dashboard')
  })

  it('never lets a poisoned fallback through either', () => {
    expect(safeReturnTo('https://evil.test', '//evil.test')).toBe(DEFAULT_RETURN_TO)
  })

  it('caps absurd lengths rather than passing them to Paystack', () => {
    expect(safeReturnTo(`/${'a'.repeat(5000)}`)).toBe(DEFAULT_RETURN_TO)
  })

  it('resolves against an origin without leaving it — the property that matters', () => {
    const base = 'https://www.e-site.live/api/paystack/callback'
    for (const hostile of ['//evil.test', 'https://evil.test', '\\\\evil.test']) {
      const url = new URL(safeReturnTo(hostile), base)
      expect(url.origin).toBe('https://www.e-site.live')
    }
  })
})

describe('returnToForFeature — a JBCC buyer must not land on the Inspections paywall', () => {
  it('sends an inspections buyer to the inspections module', () => {
    expect(returnToForFeature('inspections')).toBe('/inspections')
  })

  it('does NOT send a jbcc buyer to /inspections/unlock', () => {
    expect(returnToForFeature('jbcc')).not.toContain('inspections')
  })

  it('does NOT send a generator_cost_recovery buyer to /inspections/unlock', () => {
    expect(returnToForFeature('generator_cost_recovery')).not.toContain('inspections')
  })

  it('every default is itself a valid return path', () => {
    for (const k of ['inspections', 'jbcc', 'generator_cost_recovery'] as const) {
      const v = returnToForFeature(k)
      expect(safeReturnTo(v)).toBe(v)
    }
  })
})
