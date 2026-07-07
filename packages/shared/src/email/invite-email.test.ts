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

  it('renders the 6-digit fallback code with a prefilled code-step link when otpCode is given', () => {
    const { html } = renderInviteEmail({ ...base, otpCode: '482913' })
    expect(html).toContain('<div class="otp">482913</div>')
    expect(html).toContain(
      `href="${SITE}/reset-password?step=code&amp;email=mike%40bobsbuilding.co.za"`,
    )
    expect(html.toLowerCase()).toContain('enter this code with your email address')
  })

  it('styles the code prominently (monospace, spaced) in the dark-card design', () => {
    const { html } = renderInviteEmail({ ...base, otpCode: '482913' })
    expect(html).toMatch(/\.otp\{[^}]*ui-monospace/)
    expect(html).toMatch(/\.otp\{[^}]*letter-spacing/)
  })

  it('omits the code block entirely when otpCode is absent or blank', () => {
    expect(renderInviteEmail(base).html).not.toContain('/reset-password')
    expect(renderInviteEmail({ ...base, otpCode: '  ' }).html).not.toContain('/reset-password')
  })

  it('uses the provided linkExpiry in the expiry note', () => {
    const { html } = renderInviteEmail({ ...base, linkExpiry: '24 hours' })
    expect(html).toContain('expires in about 24 hours')
    expect(html).not.toContain('1 hour')
  })

  it('defaults the expiry note to 1 hour when linkExpiry is not given', () => {
    const { html } = renderInviteEmail(base)
    expect(html).toContain('expires in about 1 hour')
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

  it('deep-links staff to the admin project route and states single-site scoping', () => {
    const { html } = renderSiteAssignmentEmail(base)
    expect(html).toContain(`href="${SITE}/projects/${base.projectId}"`)
    expect(html.toLowerCase()).toContain('only have access to the site')
  })

  it('deep-links a client_viewer to the portal, never the admin route', () => {
    const { html } = renderSiteAssignmentEmail({ ...base, role: 'client_viewer' })
    expect(html).toContain(`href="${SITE}/portal/${base.projectId}"`)
    expect(html).not.toContain(`href="${SITE}/projects/${base.projectId}"`)
    expect(html).toContain('client portal')
  })

  it('shows the assigned role', () => {
    const { html } = renderSiteAssignmentEmail(base)
    expect(html).toContain('Contractor')
  })
})
