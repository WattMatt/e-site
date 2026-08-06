import { describe, it, expect } from 'vitest'

import {
  renderSnagVisitCompletedEmail,
  type SnagVisitCompletedEmailVars,
} from './snag-visit-email'

const vars: SnagVisitCompletedEmailVars = {
  projectId: 'proj-1',
  visitId: 'visit-1',
  projectName: 'KINGSWALK',
  visitLabel: 'Site Visit 3',
  visitDate: '2026-08-06',
  conductedByName: 'Arno Watson',
  completedByName: 'Arno Watson',
  attendees: ['J. Smith', 'P. Nkosi'],
  counts: { newSnags: 4, stillOpen: 7, closedThisVisit: 2, totalOutstanding: 11 },
  siteUrl: 'https://www.e-site.live',
}

describe('renderSnagVisitCompletedEmail', () => {
  it('names the project and visit in the subject', () => {
    const { subject } = renderSnagVisitCompletedEmail(vars)
    expect(subject).toContain('KINGSWALK')
    expect(subject).toContain('Site Visit 3')
  })

  it('renders every summary count', () => {
    const { html } = renderSnagVisitCompletedEmail(vars)
    expect(html).toContain('>4<') // new
    expect(html).toContain('>7<') // still open
    expect(html).toContain('>2<') // closed this visit
    expect(html).toContain('11')  // total outstanding
  })

  it('deep-links to the visit page (not a signed file URL)', () => {
    const { html } = renderSnagVisitCompletedEmail(vars)
    expect(html).toContain('https://www.e-site.live/projects/proj-1/snags/visits/visit-1')
  })

  it('lists who conducted and completed the visit, plus attendees', () => {
    const { html } = renderSnagVisitCompletedEmail(vars)
    expect(html).toContain('Arno Watson')
    expect(html).toContain('J. Smith')
    expect(html).toContain('P. Nkosi')
  })

  it('renders one <img> per supplied thumbnail', () => {
    const { html } = renderSnagVisitCompletedEmail({
      ...vars,
      photos: [
        { url: 'https://cdn/x1.jpg', label: 'Cracked tile' },
        { url: 'https://cdn/x2.jpg', label: 'Fixed tile' },
      ],
    })
    expect((html.match(/<img /g) ?? []).length).toBe(2)
  })

  it('summarises photos beyond the inline set', () => {
    const { html } = renderSnagVisitCompletedEmail({ ...vars, morePhotoCount: 9 })
    expect(html).toContain('9 more photo')
  })

  it('lists top defects and summarises the overflow', () => {
    const { html } = renderSnagVisitCompletedEmail({
      ...vars,
      topDefects: [
        { number: 'S-001', title: 'Cracked tile', priority: 'high', location: 'Shop 4' },
      ],
      moreDefectCount: 3,
    })
    expect(html).toContain('S-001')
    expect(html).toContain('Cracked tile')
    expect(html).toContain('Shop 4')
    expect(html).toContain('3 more')
  })

  it('omits the defect and photo blocks entirely when there are none', () => {
    const { html } = renderSnagVisitCompletedEmail(vars)
    expect(html).not.toContain('<img ')
    expect(html).not.toContain('more photo')
    expect(html).not.toContain('more defect')
  })

  it('escapes HTML in every caller-supplied string', () => {
    const { html } = renderSnagVisitCompletedEmail({
      ...vars,
      projectName: '<img src=x onerror=1>',
      conductedByName: '<script>alert(1)</script>',
      attendees: ['<b>bad</b>'],
      notes: '<iframe src=evil>',
      topDefects: [
        { number: '<i>1</i>', title: '<img src=y onerror=2>', priority: 'high', location: '<u>L</u>' },
      ],
      photos: [{ url: 'https://cdn/a.jpg"onerror="alert(1)', label: '<em>cap</em>' }],
    })
    expect(html).not.toContain('<img src=x onerror=1>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>bad</b>')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<img src=y onerror=2>')
    expect(html).not.toContain('<em>cap</em>')
    // The only <img> tags present are the ones this renderer emits itself.
    expect((html.match(/<img /g) ?? []).length).toBe(1)
  })

  it('handles the backlog visit label without a visit number', () => {
    const { subject, html } = renderSnagVisitCompletedEmail({ ...vars, visitLabel: 'Initial Backlog' })
    expect(subject).toContain('Initial Backlog')
    expect(html).toContain('Initial Backlog')
  })
})
