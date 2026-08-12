import { describe, it, expect } from 'vitest'

import {
  renderSiteFormDistributedEmail,
  asLeftStatusLabel,
  AS_LEFT_STATUS_LABELS,
  NOT_A_COC_DISCLAIMER,
  type SiteFormDistributedVars,
} from './site-form-email'

const vars: SiteFormDistributedVars = {
  projectId: 'proj-1',
  formId: 'form-1',
  formNo: 'TMS-014',
  projectName: 'KINGSWALK',
  boardLabel: 'DB-01 Shop 4',
  boardRef: 'MB 5.3',
  templateName: 'Termination & Making Safe',
  asLeftStatus: 'made_safe_de_energised',
  circuitsLeftTemporary: 0,
  electricianName: 'P. Nkosi',
  distributedByName: 'Arno Watson',
  workDate: '2026-08-12',
  accentColor: '#22C55E',
  logoUrl: null,
  siteUrl: 'https://www.e-site.live',
}

const DANGER = '#F87171'

describe('as-left status labels', () => {
  it('covers every machine token', () => {
    for (const token of [
      'made_safe_de_energised',
      'energised_returned_to_service',
      'left_isolated_lock_wm',
      'left_isolated_lock_client',
      'partially_energised',
      'decommissioned_removed',
    ]) {
      expect(AS_LEFT_STATUS_LABELS[token]).toBeTruthy()
      expect(AS_LEFT_STATUS_LABELS[token]).not.toContain('_')
    }
  })

  it('falls back to the raw token when unknown', () => {
    expect(asLeftStatusLabel('something_new')).toBe('something_new')
  })
})

describe('renderSiteFormDistributedEmail', () => {
  it('builds the subject as formNo — board — human as-left — project', () => {
    const { subject } = renderSiteFormDistributedEmail(vars)
    expect(subject).toBe('TMS-014 — DB-01 Shop 4 — Made safe — de-energised — KINGSWALK')
  })

  it('uses the human label, never the machine token, in the subject and body', () => {
    const { subject, html } = renderSiteFormDistributedEmail(vars)
    expect(subject).not.toContain('made_safe_de_energised')
    expect(html).not.toContain('made_safe_de_energised')
    expect(html).toContain('Made safe — de-energised')
  })

  it('carries the non-CoC disclaimer verbatim', () => {
    const { html } = renderSiteFormDistributedEmail(vars)
    expect(html).toContain(
      'This is a record of termination and making-safe work. It is not a Certificate of Compliance. ' +
        'A Certificate of Compliance in the form of Annexure 1 to the Electrical Installation Regulations, 2009, ' +
        'accompanied by the SANS 10142-1 test report, must be issued by a registered person for the altered part of the installation.',
    )
    expect(html).toContain(NOT_A_COC_DISCLAIMER)
  })

  it('deep-links to the form page, never to storage or a signed file URL', () => {
    const { html } = renderSiteFormDistributedEmail(vars)
    expect(html).toContain('https://www.e-site.live/projects/proj-1/forms/form-1')
    expect(html).not.toContain('/storage/')
    expect(html).not.toContain('token=')
    expect(html).not.toContain('X-Amz-Signature')
  })

  it('identifies the board, form, date and people', () => {
    const { html } = renderSiteFormDistributedEmail(vars)
    expect(html).toContain('DB-01 Shop 4')
    expect(html).toContain('MB 5.3')
    expect(html).toContain('TMS-014')
    expect(html).toContain('Termination &amp; Making Safe')
    expect(html).toContain('2026-08-12')
    expect(html).toContain('P. Nkosi')
    expect(html).toContain('Arno Watson')
  })

  it('omits the board ref and distributed-by rows when null', () => {
    const { html } = renderSiteFormDistributedEmail({
      ...vars,
      boardRef: null,
      distributedByName: null,
    })
    expect(html).not.toContain('Board ref')
    expect(html).not.toContain('Distributed by')
  })

  it('surfaces the circuits-left-temporary count when greater than zero', () => {
    const { html } = renderSiteFormDistributedEmail({ ...vars, circuitsLeftTemporary: 3 })
    expect(html).toContain('3 circuits left in a temporary state')
  })

  it('singularises the temporary-circuit callout', () => {
    const { html } = renderSiteFormDistributedEmail({ ...vars, circuitsLeftTemporary: 1 })
    expect(html).toContain('1 circuit left in a temporary state')
  })

  it('omits the temporary-circuit callout at zero', () => {
    const { html } = renderSiteFormDistributedEmail(vars)
    expect(html).not.toContain('temporary state')
  })

  it('marks C1 defects with the danger colour', () => {
    const { html } = renderSiteFormDistributedEmail({
      ...vars,
      topDefects: [{ classification: 'C1', description: 'Exposed live conductor at the gland plate' }],
    })
    expect(html).toContain(DANGER)
    expect(html).toContain('Exposed live conductor at the gland plate')
    expect(html).toContain('Immediate danger present')
  })

  it('does NOT use the danger colour for a C3 defect', () => {
    const { html } = renderSiteFormDistributedEmail({
      ...vars,
      topDefects: [{ classification: 'C3', description: 'No circuit chart on the door' }],
    })
    expect(html).not.toContain(DANGER)
    expect(html).not.toContain('Immediate danger present')
    expect(html).toContain('No circuit chart on the door')
  })

  it('renders the grade badge for every defect and summarises the overflow', () => {
    const { html } = renderSiteFormDistributedEmail({
      ...vars,
      topDefects: [
        { classification: 'C1', description: 'Live exposed' },
        { classification: 'C2', description: 'Missing earth bond' },
        { classification: 'FI', description: 'Further investigation on Circuit 7' },
      ],
      moreDefectCount: 4,
    })
    expect(html).toContain('>C1<')
    expect(html).toContain('>C2<')
    expect(html).toContain('>FI<')
    expect(html).toContain('4 more defect')
  })

  it('renders one 120x120 thumbnail per signed URL and summarises the rest', () => {
    const { html } = renderSiteFormDistributedEmail({
      ...vars,
      photos: [
        { url: 'https://cdn.example/sign/a.jpg?sig=1', caption: 'As found' },
        { url: 'https://cdn.example/sign/b.jpg?sig=2', caption: 'As left' },
      ],
      morePhotoCount: 5,
    })
    expect((html.match(/<img /g) ?? []).length).toBe(2)
    expect(html).toContain('width:120px;height:120px;object-fit:cover')
    expect(html).toContain('5 more photo')
  })

  it('NEVER emits a data: URI image, for the logo or for a photo', () => {
    const { html } = renderSiteFormDistributedEmail({
      ...vars,
      logoUrl: 'data:image/png;base64,iVBORw0KGgo=',
      photos: [
        { url: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', caption: 'inlined' },
        { url: 'https://cdn.example/sign/ok.jpg?sig=1', caption: 'signed' },
      ],
    })
    expect(html.toLowerCase()).not.toContain('data:image')
    expect((html.match(/<img /g) ?? []).length).toBe(1)
    expect(html).toContain('https://cdn.example/sign/ok.jpg?sig=1')
  })

  it('renders a branded logo from a signed URL', () => {
    const { html } = renderSiteFormDistributedEmail({
      ...vars,
      logoUrl: 'https://cdn.example/sign/logo.png?sig=9',
    })
    expect(html).toContain('https://cdn.example/sign/logo.png?sig=9')
  })

  it('applies the project accent colour', () => {
    const { html } = renderSiteFormDistributedEmail(vars)
    expect(html).toContain('#22C55E')
  })

  it('escapes HTML in the board label, project name and every other field', () => {
    const { html } = renderSiteFormDistributedEmail({
      ...vars,
      boardLabel: '<script>alert("board")</script>',
      projectName: '<img src=x onerror=1>',
      electricianName: '<b>bad</b>',
      templateName: '<iframe src=evil>',
      topDefects: [{ classification: '<u>C1</u>', description: '<em>desc</em>' }],
      photos: [{ url: 'https://cdn/a.jpg"onerror="alert(1)', caption: '<i>cap</i>' }],
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('alert("board")')
    expect(html).not.toContain('<img src=x onerror=1>')
    expect(html).not.toContain('<b>bad</b>')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<em>desc</em>')
    expect(html).not.toContain('<i>cap</i>')
    expect(html).not.toContain('"onerror="')
    // The only <img> is the thumbnail this renderer emits itself.
    expect((html.match(/<img /g) ?? []).length).toBe(1)
  })
})

// ─── A missing handover state must never be defaulted ────────────────────────
// Regression: the caller defaulted a null as_left_status to
// 'made_safe_de_energised', so a board whose handover was never recorded was
// announced to the whole project as safely de-energised — while the PDF from
// the same distribution said "Not recorded".
describe('as-left status is never invented', () => {
  it('renders "Not recorded" when the status is null', () => {
    const { subject, html } = renderSiteFormDistributedEmail({
      ...vars,
      asLeftStatus: null,
    })
    expect(subject).toContain('Not recorded')
    expect(html).toContain('Not recorded')
  })

  it('never claims a safe state for an unrecorded handover', () => {
    const { subject, html } = renderSiteFormDistributedEmail({
      ...vars,
      asLeftStatus: null,
    })
    expect(subject).not.toContain('Made safe')
    expect(html).not.toContain('Made safe — de-energised')
  })

  it('treats an empty string the same as null', () => {
    expect(
      renderSiteFormDistributedEmail({ ...vars, asLeftStatus: '   ' }).subject,
    ).toContain('Not recorded')
  })

  it('still renders a real status normally', () => {
    expect(
      renderSiteFormDistributedEmail({ ...vars, asLeftStatus: 'partially_energised' }).subject,
    ).toContain('Partially energised')
  })
})
