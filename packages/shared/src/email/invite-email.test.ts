import { describe, it, expect } from 'vitest'
import { renderInviteEmail, renderSiteAssignmentEmail, roleLabel } from './invite-email'

const SITE = 'https://app.e-site.live'

describe('roleLabel', () => {
  it('maps known role slugs to readable labels', () => {
    expect(roleLabel('project_manager')).toBe('Project Manager')
    expect(roleLabel('client_viewer')).toBe('Client Viewer (read-only)')
    expect(roleLabel('contractor')).toBe('Contractor')
  })
  it('falls back to a de-slugged label for unknown roles', () => {
    expect(roleLabel('some_new_role')).toBe('some new role')
  })
})

describe('renderInviteEmail', () => {
  const base = {
    recipientEmail: 'mike@bobsbuilding.co.za',
    inviterName: 'Arno Mattheus',
    orgName: "Bob's Building",
    role: 'contractor',
    actionLink: 'https://app.e-site.live/auth/verify?token=abc',
    siteUrl: SITE,
  }

  it('names the inviter and company in the subject (anti-spam context)', () => {
    const { subject } = renderInviteEmail(base)
    expect(subject).toContain('Arno Mattheus')
    expect(subject).toContain("Bob's Building")
    expect(subject.toLowerCase()).toContain('set your password')
  })

  it('states who added them, the company, and the role in the body', () => {
    const { html } = renderInviteEmail(base)
    expect(html).toContain('Arno Mattheus')
    expect(html).toContain("Bob's Building")
    expect(html).toContain('Contractor')
  })

  it('embeds the set-password action link on the CTA', () => {
    const { html } = renderInviteEmail(base)
    expect(html).toContain('href="https://app.e-site.live/auth/verify?token=abc"')
  })

  it('lists assigned sites and states single-site scoping when sites are given', () => {
    const { html } = renderInviteEmail({ ...base, siteNames: ['KINGSWALK', 'Harbour View'] })
    expect(html).toContain('KINGSWALK')
    expect(html).toContain('Harbour View')
    expect(html.toLowerCase()).toContain("only see the site")
  })

  it('explains sites are coming when none assigned yet', () => {
    const { html } = renderInviteEmail(base)
    expect(html.toLowerCase()).toContain('specific site')
  })

  it('echoes the recipient email for anti-phishing clarity', () => {
    const { html } = renderInviteEmail(base)
    expect(html).toContain('mike@bobsbuilding.co.za')
  })

  it('shows the managing company for sub-org invites', () => {
    const { html } = renderInviteEmail({ ...base, managingCompanyName: 'WM Consulting' })
    expect(html).toContain('WM Consulting')
  })

  it('escapes HTML in user-supplied names', () => {
    const { html } = renderInviteEmail({ ...base, inviterName: '<script>x</script>' })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('falls back to a generic inviter label when name is blank', () => {
    const { subject } = renderInviteEmail({ ...base, inviterName: '' })
    expect(subject).toContain('A team member')
  })
})

describe('renderSiteAssignmentEmail', () => {
  const base = {
    inviterName: 'Arno Mattheus',
    siteName: 'KINGSWALK',
    projectId: '11111111-1111-1111-1111-111111111111',
    role: 'contractor',
    siteUrl: SITE,
  }

  it('names the site and inviter in the subject', () => {
    const { subject } = renderSiteAssignmentEmail(base)
    expect(subject).toContain('KINGSWALK')
    expect(subject).toContain('Arno Mattheus')
  })

  it('deep-links to the project and states single-site scoping', () => {
    const { html } = renderSiteAssignmentEmail(base)
    expect(html).toContain(`href="${SITE}/projects/${base.projectId}"`)
    expect(html.toLowerCase()).toContain('only have access to the site')
  })

  it('shows the assigned role', () => {
    const { html } = renderSiteAssignmentEmail(base)
    expect(html).toContain('Contractor')
  })
})
