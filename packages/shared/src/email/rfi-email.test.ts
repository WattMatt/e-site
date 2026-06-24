import { describe, it, expect } from 'vitest'
import { buildRfiEmailRecipients, renderRfiCreatedEmail } from './rfi-email'

describe('buildRfiEmailRecipients', () => {
  const base = {
    notifyRfiEmail: true,
    assigneeEmail: 'assignee@example.com',
    raiserEmail: 'raiser@example.com',
    notifyRfiTo: ['watcher@example.com'],
  }

  it('returns [] when notifyRfiEmail is off (toggle gates everything)', () => {
    expect(buildRfiEmailRecipients({ ...base, notifyRfiEmail: false })).toEqual([])
  })

  it('unions assignee + raiser + notifyRfiTo when on', () => {
    expect(buildRfiEmailRecipients(base).sort()).toEqual(
      ['assignee@example.com', 'raiser@example.com', 'watcher@example.com'].sort(),
    )
  })

  it('dedupes case-insensitively (assignee == a watcher)', () => {
    const r = buildRfiEmailRecipients({
      ...base,
      raiserEmail: null,
      notifyRfiTo: ['ASSIGNEE@example.com', 'watcher@example.com'],
    })
    expect(r).toHaveLength(2)
    expect(r.map((e) => e.toLowerCase()).sort()).toEqual(['assignee@example.com', 'watcher@example.com'])
  })

  it('drops null/empty/invalid entries', () => {
    const r = buildRfiEmailRecipients({
      notifyRfiEmail: true,
      assigneeEmail: null,
      raiserEmail: '',
      notifyRfiTo: ['not-an-email', '  ', 'ok@example.com'],
    })
    expect(r).toEqual(['ok@example.com'])
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
