import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sendTenderEmail = vi.fn(async () => ({ ok: true }) as { ok: true } | { error: string })
vi.mock('./access', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, sendTenderEmail: (...a: unknown[]) => sendTenderEmail(...(a as [])) }
})

import {
  renderAddendumEmail,
  renderAnswerEmail,
  renderCancelledEmail,
  renderClosingExtendedEmail,
  renderQuestionReceivedEmail,
  renderReceiptEmail,
  sendToMany,
  tenderAudience,
} from './notify'

const tender = { package: 'Electrical contract', title: 'Mall rewire', reference: 'WM-T-7', closing_at: '2026-10-23T15:00:00Z' }

beforeEach(() => {
  sendTenderEmail.mockClear()
  process.env.TENDER_INVITES_ENABLED = 'true'
})
afterEach(() => {
  delete process.env.TENDER_INVITES_ENABLED
})

describe('the lifecycle emails', () => {
  it('addendum: names the addendum, warns a submitted bid returned to draft, carries the closing time and the portal link', () => {
    const { subject, html } = renderAddendumEmail({ projectName: 'P', tender, addendumTitle: 'Addendum 1: revised SLD' })
    expect(subject).toBe('Addendum — Electrical contract — Mall rewire (WM-T-7)')
    expect(html).toContain('Addendum 1: revised SLD')
    expect(html).toContain('your bid has returned to draft')
    expect(html).toContain('/tender/login')
    expect(html).toContain('2026') // the closing time is rendered
  })
  it('answer: names the question and says the asker is never named', () => {
    const { subject, html } = renderAnswerEmail({ projectName: 'P', tender, questionTitle: 'Cable type for feeder F3?' })
    expect(subject).toContain('Question answered')
    expect(html).toContain('Cable type for feeder F3?')
    expect(html).toContain('never named')
  })
  it('question received: carries the company, the words of the question and the admin link, escaped', () => {
    const { html } = renderQuestionReceivedEmail({
      projectName: 'P',
      tender,
      company: 'Power & Light <CC>',
      questionTitle: 'Is <b>night work</b> allowed?',
      questionBody: 'Section 3 & 4 silent.',
      adminLink: 'https://www.e-site.live/projects/x/tenders/y',
    })
    expect(html).toContain('Power &amp; Light &lt;CC&gt;')
    expect(html).toContain('Is &lt;b&gt;night work&lt;/b&gt; allowed?')
    expect(html).toContain('Section 3 &amp; 4 silent.')
    expect(html).toContain('https://www.e-site.live/projects/x/tenders/y')
  })
  it('receipt: the proof a bidder keeps — company, time, total, validity', () => {
    const { subject, html } = renderReceiptEmail({
      projectName: 'P',
      tender,
      companyName: 'Power Test Contractors',
      submittedAt: '2026-10-20T08:00:00Z',
      total: 51337,
      validityDays: 90,
    })
    expect(subject).toContain('Tender submitted')
    expect(html).toContain('Power Test Contractors')
    expect(html).toContain('R 51 337.00')
    expect(html).toContain('90 days after closing')
    expect(html).toContain('sealed until the closing time')
  })
  it('extension and cancellation say exactly what changed', () => {
    expect(renderClosingExtendedEmail({ projectName: 'P', tender, newClosing: '2026-10-30T15:00:00Z' }).html).toContain('extended to')
    const cancelled = renderCancelledEmail({ projectName: 'P', tender })
    expect(cancelled.subject).toContain('Tender cancelled')
    expect(cancelled.html).toContain('stays sealed, permanently')
  })
})

describe('tenderAudience', () => {
  it('dedupes addresses across live invitations, case-insensitively', async () => {
    const rows = [
      { email: 'A@x.co.za', status: 'sent' },
      { email: 'a@x.co.za', status: 'accepted' },
      { email: 'b@y.co.za', status: 'prepared' },
    ]
    const supabase = {
      schema: () => ({
        from: () => ({
          select: () => ({ eq: () => ({ in: async () => ({ data: rows }) }) }),
        }),
      }),
    }
    const out = await tenderAudience(supabase as never, 't1')
    expect(out.sort()).toEqual(['a@x.co.za', 'b@y.co.za'])
  })
})

describe('sendToMany', () => {
  it('sends nothing while the switch is off, and says so', async () => {
    delete process.env.TENDER_INVITES_ENABLED
    const out = await sendToMany(['a@x.co.za'], 's', 'h')
    expect(out).toEqual({ sent: 0, failed: 0, off: true })
    expect(sendTenderEmail).not.toHaveBeenCalled()
  })
  it('counts failures without throwing', async () => {
    sendTenderEmail.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ error: 'down' })
    const out = await sendToMany(['a@x.co.za', 'b@y.co.za'], 's', 'h')
    expect(out).toEqual({ sent: 1, failed: 1, off: false })
  })
})
