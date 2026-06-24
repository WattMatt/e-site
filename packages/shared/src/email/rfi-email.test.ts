import { describe, it, expect } from 'vitest'
import { buildRfiEmailRecipients, renderRfiCreatedEmail } from './rfi-email'

describe('buildRfiEmailRecipients', () => {
  it('returns [] when notifyRfiEmail is off (toggle gates everything)', () => {
    expect(buildRfiEmailRecipients({ notifyRfiEmail: false, emails: ['a@example.com'] })).toEqual([])
  })

  it('returns the deduped valid emails when on (e.g. project members)', () => {
    expect(
      buildRfiEmailRecipients({ notifyRfiEmail: true, emails: ['a@example.com', 'b@example.com'] }).sort(),
    ).toEqual(['a@example.com', 'b@example.com'])
  })

  it('dedupes case-insensitively', () => {
    const r = buildRfiEmailRecipients({
      notifyRfiEmail: true,
      emails: ['A@example.com', 'a@example.com', 'b@example.com'],
    })
    expect(r).toHaveLength(2)
    expect(r.map((e) => e.toLowerCase()).sort()).toEqual(['a@example.com', 'b@example.com'])
  })

  it('drops null/empty/invalid entries', () => {
    expect(
      buildRfiEmailRecipients({
        notifyRfiEmail: true,
        emails: [null, '', '  ', 'not-an-email', 'ok@example.com'],
      }),
    ).toEqual(['ok@example.com'])
  })
})

describe('renderRfiCreatedEmail', () => {
  const vars = {
    raisedByName: 'Jane Raiser',
    assigneeName: 'Bob Assignee',
    rfiSubject: 'Need clarification on busbar rating',
    projectName: 'Centurion Substation',
    priority: 'high',
    dueDate: '2026-07-01',
    rfiId: 'abc-123',
    siteUrl: 'https://app.e-site.live',
  }

  it('subject is "New RFI: <subject>"', () => {
    expect(renderRfiCreatedEmail(vars).subject).toBe('New RFI: Need clarification on busbar rating')
  })

  it('html contains the deep link to the RFI', () => {
    expect(renderRfiCreatedEmail(vars).html).toContain('https://app.e-site.live/rfis/abc-123')
  })

  it('html contains the description (subject, priority, due, project)', () => {
    const { html } = renderRfiCreatedEmail(vars)
    expect(html).toContain('Need clarification on busbar rating')
    expect(html).toContain('high')
    expect(html).toContain('2026-07-01')
    expect(html).toContain('Centurion Substation')
  })

  it('falls back to "Unassigned" when assigneeName is null', () => {
    expect(renderRfiCreatedEmail({ ...vars, assigneeName: null }).html).toContain('Unassigned')
  })

  it('escapes HTML in user-supplied fields (no XSS injection)', () => {
    const { html } = renderRfiCreatedEmail({ ...vars, rfiSubject: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
