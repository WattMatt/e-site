import { describe, it, expect } from 'vitest'
import {
  buildRfiEmailRecipients,
  renderRfiCreatedEmail,
  renderSnagCreatedEmail,
  renderSnagStatusEmail,
  renderDiaryCreatedEmail,
} from './rfi-email'

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

describe('renderSnagCreatedEmail', () => {
  const vars = {
    raisedByName: 'Jane Raiser',
    assigneeName: 'Bob Assignee',
    snagTitle: 'Cracked tile in DB room',
    projectName: 'Centurion Substation',
    priority: 'high',
    dueDate: '2026-07-01',
    snagId: 'snag-123',
    siteUrl: 'https://app.e-site.live',
  }

  it('subject is "New snag: <title>"', () => {
    expect(renderSnagCreatedEmail(vars).subject).toBe('New snag: Cracked tile in DB room')
  })

  it('html contains the deep link to the snag', () => {
    expect(renderSnagCreatedEmail(vars).html).toContain('https://app.e-site.live/snags/snag-123')
  })

  it('falls back to "Unassigned" when assigneeName is null', () => {
    expect(renderSnagCreatedEmail({ ...vars, assigneeName: null }).html).toContain('Unassigned')
  })

  it('escapes HTML in user-supplied fields', () => {
    const { html } = renderSnagCreatedEmail({ ...vars, snagTitle: '<img src=x onerror=1>' })
    expect(html).not.toContain('<img src=x onerror=1>')
    expect(html).toContain('&lt;img')
  })
})

describe('renderSnagStatusEmail', () => {
  const vars = {
    snagTitle: 'Cracked tile in DB room',
    projectName: 'Centurion Substation',
    statusLabel: 'Signed Off',
    changedByName: 'Bob Inspector',
    snagId: 'snag-123',
    siteUrl: 'https://app.e-site.live',
  }

  it('subject reflects the new status and title', () => {
    expect(renderSnagStatusEmail(vars).subject).toBe('Snag Signed Off: Cracked tile in DB room')
  })

  it('html contains the deep link, status label and who changed it', () => {
    const { html } = renderSnagStatusEmail(vars)
    expect(html).toContain('https://app.e-site.live/snags/snag-123')
    expect(html).toContain('Signed Off')
    expect(html).toContain('Bob Inspector')
  })

  it('omits the actor line gracefully when changedByName is null', () => {
    const { html } = renderSnagStatusEmail({ ...vars, changedByName: null })
    expect(html).toContain('Signed Off')
    expect(html).not.toContain('null')
  })

  it('escapes HTML in user-supplied fields', () => {
    const { html } = renderSnagStatusEmail({ ...vars, snagTitle: '<script>x</script>' })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('renderDiaryCreatedEmail', () => {
  const vars = {
    authorName: 'Jane Foreman',
    projectName: 'Centurion Substation',
    entryDate: '2026-06-24',
    summary: 'Poured slab on level 2. 14 workers on site.',
    projectId: 'proj-123',
    siteUrl: 'https://app.e-site.live',
  }

  it('subject is "Site diary — <project> (<date>)"', () => {
    expect(renderDiaryCreatedEmail(vars).subject).toBe('Site diary — Centurion Substation (2026-06-24)')
  })

  it('html links to the project diary and contains the summary', () => {
    const { html } = renderDiaryCreatedEmail(vars)
    expect(html).toContain('https://app.e-site.live/projects/proj-123/diary')
    expect(html).toContain('Poured slab on level 2')
  })

  it('escapes HTML in the summary', () => {
    const { html } = renderDiaryCreatedEmail({ ...vars, summary: '<b>bold</b>' })
    expect(html).not.toContain('<b>bold</b>')
    expect(html).toContain('&lt;b&gt;')
  })
})
