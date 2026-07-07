import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendInviteEmail, sendSiteAssignmentEmail } from './invite-email'

// A minimal service-client stub exposing only what the helper uses.
function makeService(overrides: {
  actionLink?: string | null
  emailOtp?: string
  generateLinkError?: unknown
  invokeError?: unknown
  resetError?: unknown
} = {}) {
  const generateLink = vi.fn().mockResolvedValue({
    data: overrides.actionLink === null ? { properties: {} } : { properties: { action_link: overrides.actionLink ?? 'https://app.e-site.live/verify?t=abc', email_otp: overrides.emailOtp ?? '654321' } },
    error: overrides.generateLinkError ?? null,
  })
  const invoke = vi.fn().mockResolvedValue({ data: null, error: overrides.invokeError ?? null })
  const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: overrides.resetError ?? null })
  const service = {
    auth: { admin: { generateLink }, resetPasswordForEmail },
    functions: { invoke },
  }
  return { service, generateLink, invoke, resetPasswordForEmail }
}

const base = {
  email: 'mike@bobsbuilding.co.za',
  inviterName: 'Arno Mattheus',
  orgName: "Bob's Building",
  role: 'contractor',
}

describe('sendInviteEmail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('generates a recovery link and sends the branded invite (no fallback)', async () => {
    const { service, generateLink, invoke, resetPasswordForEmail } = makeService()
    const res = await sendInviteEmail({ service: service as any, ...base, siteNames: ['KINGSWALK'] })

    expect(res.ok).toBe(true)
    expect(res.warning).toBeUndefined()
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'recovery', email: base.email }),
    )
    // Sent through the send-email edge fn as an 'invite' passthrough with rendered html.
    expect(invoke).toHaveBeenCalledWith('send-email', expect.objectContaining({
      body: expect.objectContaining({ type: 'account-invite' }),
    }))
    const payload = invoke.mock.calls[0][1].body.payload
    expect(payload.to).toBe(base.email)
    expect(payload.html).toContain('KINGSWALK')
    expect(payload.html).toContain('https://app.e-site.live/verify?t=abc')
    expect(resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('embeds the email_otp code and the 24-hour expiry in the rendered invite', async () => {
    const { service, invoke } = makeService({ emailOtp: '918273' })
    const res = await sendInviteEmail({ service: service as any, ...base })

    expect(res.ok).toBe(true)
    const payload = invoke.mock.calls[0][1].body.payload
    expect(payload.html).toContain('918273')
    expect(payload.html).toContain('/reset-password')
    expect(payload.html).toContain('24 hours')
  })

  it('still sends the branded invite when generateLink returns no email_otp', async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { properties: { action_link: 'https://app.e-site.live/verify?t=abc' } },
      error: null,
    })
    const invoke = vi.fn().mockResolvedValue({ data: null, error: null })
    const service = {
      auth: { admin: { generateLink }, resetPasswordForEmail: vi.fn() },
      functions: { invoke },
    }
    const res = await sendInviteEmail({ service: service as any, ...base })

    expect(res.ok).toBe(true)
    const payload = invoke.mock.calls[0][1].body.payload
    expect(payload.html).not.toContain('/reset-password')
    expect(payload.html).toContain('24 hours')
  })

  it('falls back to the plain recovery email when the link cannot be generated', async () => {
    const { service, invoke, resetPasswordForEmail } = makeService({ generateLinkError: new Error('nope') })
    const res = await sendInviteEmail({ service: service as any, ...base })

    expect(res.ok).toBe(true)
    expect(res.warning).toMatch(/branded invite/i)
    expect(invoke).not.toHaveBeenCalled()
    expect(resetPasswordForEmail).toHaveBeenCalledWith(base.email, expect.any(Object))
  })

  it('falls back to recovery when the send-email invoke fails', async () => {
    const { service, resetPasswordForEmail } = makeService({ invokeError: new Error('edge down') })
    const res = await sendInviteEmail({ service: service as any, ...base })

    expect(res.ok).toBe(true)
    expect(resetPasswordForEmail).toHaveBeenCalled()
  })

  it('returns ok:false with a warning when both the invite and the fallback fail', async () => {
    const { service } = makeService({ generateLinkError: new Error('x'), resetError: new Error('y') })
    const res = await sendInviteEmail({ service: service as any, ...base })

    expect(res.ok).toBe(false)
    expect(res.warning).toMatch(/could not be sent/i)
  })

  it('never throws even if the service client itself explodes', async () => {
    const service = {
      auth: { admin: { generateLink: () => { throw new Error('boom') } }, resetPasswordForEmail: () => { throw new Error('boom2') } },
      functions: { invoke: vi.fn() },
    }
    const res = await sendInviteEmail({ service: service as any, ...base })
    expect(res.ok).toBe(false)
  })
})

describe('sendSiteAssignmentEmail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends a rendered site-assignment email via the edge fn', async () => {
    const { service, invoke } = makeService()
    await sendSiteAssignmentEmail({
      service: service as any,
      email: base.email,
      inviterName: base.inviterName,
      siteName: 'KINGSWALK',
      projectId: '11111111-1111-1111-1111-111111111111',
      role: 'contractor',
    })
    expect(invoke).toHaveBeenCalledWith('send-email', expect.objectContaining({
      body: expect.objectContaining({ type: 'account-invite' }),
    }))
    const payload = invoke.mock.calls[0][1].body.payload
    expect(payload.to).toBe(base.email)
    expect(payload.html).toContain('KINGSWALK')
  })

  it('never throws when the edge fn fails', async () => {
    const { service } = makeService({ invokeError: new Error('down') })
    await expect(
      sendSiteAssignmentEmail({
        service: service as any,
        email: base.email,
        inviterName: base.inviterName,
        siteName: 'KINGSWALK',
        projectId: '11111111-1111-1111-1111-111111111111',
        role: 'contractor',
      }),
    ).resolves.toBeUndefined()
  })
})
