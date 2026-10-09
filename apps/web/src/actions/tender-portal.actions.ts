'use server'

/**
 * The tenderer side (E5 slice B). A tenderer is an auth user with no
 * organisation; everything they read comes through the column-limited
 * projects.tender_portal_* functions (00243), and the only row they write is
 * their own participant profile.
 *
 * Getting in (redesigned 2026-10-07, lib/tender/access.ts): the invitation
 * EMAIL carries a single-use sign-in for the invited address. The invitation
 * page uses it only when the person presses Continue (mail scanners that open
 * links cannot burn it). No password, no separate "sign in" step: a new
 * contractor's account is created by that first Continue. A link copied out of
 * E-Site by WM carries no sign-in; that page emails a fresh link and code to
 * the invited address instead. Accepting stays a separate, explicit step,
 * signed in AS that address, through projects.tender_accept.
 */

import { headers } from 'next/headers'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import type { AnyClient } from '@/lib/tender/gate'
import {
  INVITATION_REFUSAL_TEXT,
  checkInvitation,
  emailMatches,
  hashInvitationToken,
  looksLikeInvitationToken,
  newInvitationToken,
} from '@/lib/tender/invitation'
import { splitEmails } from '@/lib/tender/parse-tender-list'
import {
  invitationAccessLink,
  isTenderOtpType,
  mintTenderAccess,
  renderAccessEmail,
  returnAccessLink,
  sendTenderEmail,
} from '@/lib/tender/access'
import { validateProfile, type ProfileInput } from '@/lib/tender/profile'

type Result<T> = { data: T } | { error: string }

async function clientIp(): Promise<string> {
  const h = await headers()
  return (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown'
}

interface InvitationLookup {
  invitation: { id: string; tender_id: string; status: string; token_expires_at: string | null; email: string; company_name: string; contact_name: string | null; phone: string | null }
  tender: { id: string; status: string; closing_at: string | null; package: string; title: string; project_id: string; organisation_id: string }
}

async function lookup(token: string): Promise<InvitationLookup | null> {
  if (!looksLikeInvitationToken(token)) return null
  const svc = createServiceClient() as AnyClient
  const { data: inv } = await svc
    .schema('projects')
    .from('tender_invitations')
    .select('id, tender_id, status, token_expires_at, email, company_name, contact_name, phone')
    .eq('token_hash', hashInvitationToken(token))
    .maybeSingle()
  if (!inv) return null
  const { data: tender } = await svc
    .schema('projects')
    .from('tenders')
    .select('id, status, closing_at, package, title, project_id, organisation_id')
    .eq('id', inv.tender_id)
    .maybeSingle()
  return tender ? { invitation: inv, tender } : null
}

export interface InvitationPreview {
  companyName: string
  email: string
  package: string
  title: string
  projectName: string
  organisationName: string
  closingAt: string | null
  /** The signed-in user's address when there is a session, else null. */
  signedInAs: string | null
  /** True when signed in as the invited address: Accept is offered. */
  canAccept: boolean
}

export async function previewInvitationAction(token: string): Promise<Result<InvitationPreview>> {
  if (!rateLimit(`tender-invite-view:${await clientIp()}`, 30, 60_000)) return { error: 'Too many requests. Wait a minute and try again.' }
  const found = await lookup(token)
  const check = checkInvitation(found?.invitation ?? null, found?.tender ?? null, new Date())
  if (!check.ok) return { error: INVITATION_REFUSAL_TEXT[check.reason] }
  const svc = createServiceClient() as AnyClient
  const [{ data: proj }, { data: org }] = await Promise.all([
    svc.schema('projects').from('projects').select('name').eq('id', found!.tender.project_id).maybeSingle(),
    svc.from('organisations').select('name').eq('id', found!.tender.organisation_id).maybeSingle(),
  ])
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const signedInAs = user?.email ?? null
  return {
    data: {
      companyName: found!.invitation.company_name,
      email: found!.invitation.email,
      package: found!.tender.package,
      title: found!.tender.title,
      projectName: proj?.name ?? '',
      organisationName: org?.name ?? '',
      closingAt: found!.tender.closing_at,
      signedInAs,
      canAccept: emailMatches(signedInAs, found!.invitation.email),
    },
  }
}

const CODE_RE = /^\d{6}$/
const TOKEN_HASH_RE = /^[A-Za-z0-9_-]{20,128}$/

/** Use a single-use sign-in (from an email link) or a 6-digit code, as the cookie session. */
async function useAccess(
  input: { tokenHash: string; type: string } | { email: string; code: string },
): Promise<{ ok: true; email: string } | { ok: false }> {
  const supabase = await createClient()
  if ('tokenHash' in input) {
    if (!TOKEN_HASH_RE.test(input.tokenHash) || !isTenderOtpType(input.type)) return { ok: false }
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: input.tokenHash, type: input.type })
    return error || !data.user?.email ? { ok: false } : { ok: true, email: data.user.email }
  }
  if (!CODE_RE.test(input.code)) return { ok: false }
  // A code minted for a brand-new address is a signup code; for an existing one, an email code.
  for (const type of ['email', 'signup'] as const) {
    const { data, error } = await supabase.auth.verifyOtp({ email: input.email, token: input.code, type })
    if (!error && data.user?.email) return { ok: true, email: data.user.email }
  }
  return { ok: false }
}

const LINK_USED = 'That link has already been used or has expired. Press "Email me a fresh link" below.'
const CODE_WRONG = 'That code is not right, or it has expired. Check the latest email, or ask for a fresh link.'

/**
 * Continue from the invitation email: the button on the invitation page. Signs
 * in as the invited address (creating the account on first use), never as
 * anyone else.
 */
export async function continueInvitationAction(token: string, k: string, t: string): Promise<Result<true>> {
  if (!rateLimit(`tender-invite-continue:${await clientIp()}`, 20, 60_000)) return { error: 'Too many attempts. Wait a minute and try again.' }
  const found = await lookup(token)
  const check = checkInvitation(found?.invitation ?? null, found?.tender ?? null, new Date())
  if (!check.ok) return { error: INVITATION_REFUSAL_TEXT[check.reason] }
  const r = await useAccess({ tokenHash: k, type: t })
  if (!r.ok) return { error: LINK_USED }
  if (!emailMatches(r.email, found!.invitation.email)) {
    await (await createClient()).auth.signOut()
    return { error: 'That link belongs to a different address.' }
  }
  return { data: true }
}

/** The 6-digit code from an invitation or fresh-link email. */
export async function continueInvitationWithCodeAction(token: string, code: string): Promise<Result<true>> {
  if (!rateLimit(`tender-invite-code:${await clientIp()}`, 10, 60_000)) return { error: 'Too many attempts. Wait a minute and try again.' }
  const found = await lookup(token)
  const check = checkInvitation(found?.invitation ?? null, found?.tender ?? null, new Date())
  if (!check.ok) return { error: INVITATION_REFUSAL_TEXT[check.reason] }
  const r = await useAccess({ email: found!.invitation.email, code: code.trim() })
  return r.ok ? { data: true } : { error: CODE_WRONG }
}

/**
 * Email a fresh link and code to the INVITED address (never anyone else), back
 * to this invitation. For a link copied out of E-Site, or one used or expired.
 * Reports a failure to send instead of claiming success.
 */
export async function emailInvitationLinkAction(token: string): Promise<Result<{ email: string }>> {
  if (!rateLimit(`tender-invite-link:${await clientIp()}`, 5, 60_000)) return { error: 'Too many requests. Wait a minute and try again.' }
  const found = await lookup(token)
  const check = checkInvitation(found?.invitation ?? null, found?.tender ?? null, new Date())
  if (!check.ok) return { error: INVITATION_REFUSAL_TEXT[check.reason] }
  if (!rateLimit(`tender-invite-link-inv:${found!.invitation.id}`, 5, 60 * 60_000)) return { error: 'Several links were sent in the last hour. Use the latest email, or try again later.' }
  const email = found!.invitation.email
  const access = await mintTenderAccess(createServiceClient() as AnyClient, email)
  if ('error' in access) return access
  const { subject, html } = renderAccessEmail({
    email,
    link: invitationAccessLink(token, access),
    code: access.code,
    what: `the ${found!.tender.package} tender: ${found!.tender.title}`,
  })
  const sent = await sendTenderEmail(email, subject, html)
  if ('error' in sent) return sent
  return { data: { email } }
}

/** Step 2: accept, signed in as the invited address. */
export async function acceptInvitationAction(token: string): Promise<Result<{ tenderId: string }>> {
  if (!rateLimit(`tender-invite-accept:${await clientIp()}`, 10, 60_000)) return { error: 'Too many attempts. Wait a minute and try again.' }
  if (!looksLikeInvitationToken(token)) return { error: INVITATION_REFUSAL_TEXT.not_found }
  const supabase = (await createClient()) as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Open the invitation from its email first, then press Continue.' }
  return acceptByHash(supabase, hashInvitationToken(token))
}

async function acceptByHash(supabase: AnyClient, tokenHash: string): Promise<Result<{ tenderId: string }>> {
  const { data, error } = await supabase.schema('projects').rpc('tender_accept', { p_token_hash: tokenHash })
  if (error) {
    const reason =
      error.code === '42501' && /emailed/.test(error.message) ? 'needs_email_link'
      : error.code === '42501' ? 'wrong_account'
      : error.code === 'P0002' ? 'not_found'
      : /expired/.test(error.message) ? 'expired'
      : /not open/.test(error.message) ? 'closed'
      : /accepted/.test(error.message) ? 'used'
      : /revoked/.test(error.message) ? 'revoked'
      : null
    return { error: reason ? INVITATION_REFUSAL_TEXT[reason] : 'Could not accept the invitation. Try again.' }
  }
  return { data: { tenderId: data as string } }
}

/** An address that has (or had) a tender invitation that went out. Exact match: stored lower-case by CHECK. */
async function hasTenderInvitation(svc: AnyClient, address: string): Promise<boolean> {
  const { data } = await svc.schema('projects').from('tender_invitations').select('id').eq('email', address).in('status', ['sent', 'accepted']).limit(1)
  return !!data?.length
}

/**
 * Return visits (/tender/login): email a link and code to an address that has
 * a tender invitation. Same answer either way (no account probing); a send
 * that fails for a real tenderer is logged. It never touches an invitation:
 * anyone may ask for an address, so a request must not be able to kill the
 * bidder's invitation link. A bidder who has not accepted yet finds the
 * invitation on /tender once signed in (pendingInvitationsAction).
 */
export async function requestTenderAccessAction(email: string): Promise<Result<true>> {
  if (!rateLimit(`tender-signin:${await clientIp()}`, 5, 60_000)) return { error: 'Too many requests. Wait a minute and try again.' }
  const { valid } = splitEmails(email)
  if (valid.length !== 1) return { error: 'Enter the email address your invitation was sent to' }
  const address = valid[0]
  const svc = createServiceClient() as AnyClient
  if ((await hasTenderInvitation(svc, address)) && rateLimit(`tender-signin-addr:${address}`, 3, 60 * 60_000)) {
    const access = await mintTenderAccess(svc, address)
    if (!('error' in access)) {
      const { subject, html } = renderAccessEmail({ email: address, link: returnAccessLink(access, address), code: access.code, what: 'your tenders on E-Site' })
      const sent = await sendTenderEmail(address, subject, html)
      if ('error' in sent) console.error('requestTenderAccessAction: send failed for a tenderer')
    }
  }
  return { data: true }
}

/** The Continue button on /tender/login, from a return-visit email. */
export async function continueReturnVisitAction(k: string, t: string): Promise<Result<true>> {
  if (!rateLimit(`tender-return-continue:${await clientIp()}`, 20, 60_000)) return { error: 'Too many attempts. Wait a minute and try again.' }
  const r = await useAccess({ tokenHash: k, type: t })
  return r.ok ? { data: true } : { error: 'That link has already been used, or a newer email replaced it. Go to "Your tenders" and ask for a fresh link.' }
}

/** The 6-digit code on /tender/login: only for an address with a tender invitation, a few tries per address. */
export async function continueReturnVisitWithCodeAction(email: string, code: string): Promise<Result<true>> {
  if (!rateLimit(`tender-return-code:${await clientIp()}`, 10, 60_000)) return { error: 'Too many attempts. Wait a minute and try again.' }
  const { valid } = splitEmails(email)
  if (valid.length !== 1) return { error: 'Enter the email address your invitation was sent to' }
  const address = valid[0]
  if (!rateLimit(`tender-code-addr:${address}`, 5, 60 * 60_000)) return { error: 'Too many tries for this address. Ask for a fresh link and code, or wait an hour.' }
  if (!CODE_RE.test(code.trim()) || !(await hasTenderInvitation(createServiceClient() as AnyClient, address))) return { error: CODE_WRONG }
  const r = await useAccess({ email: address, code: code.trim() })
  return r.ok ? { data: true } : { error: CODE_WRONG }
}

export interface PendingInvitation {
  id: string
  company_name: string
  package: string
  title: string
  closing_at: string | null
}

/** Invitations to the signed-in address that are still waiting for Accept, on tenders that are open. */
export async function pendingInvitationsAction(): Promise<Result<PendingInvitation[]>> {
  const supabase = (await createClient()) as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: 'Not signed in' }
  const svc = createServiceClient() as AnyClient
  const { data } = await svc
    .schema('projects')
    .from('tender_invitations')
    .select('id, company_name, tender:tenders(package, title, status, closing_at)')
    .eq('email', user.email.toLowerCase())
    .in('status', ['prepared', 'sent'])
    .limit(20)
  const now = Date.now()
  return {
    data: ((data ?? []) as { id: string; company_name: string; tender: { package: string; title: string; status: string; closing_at: string | null } | null }[])
      .filter((r) => r.tender?.status === 'issued' && !!r.tender.closing_at && new Date(r.tender.closing_at).getTime() > now)
      .map((r) => ({ id: r.id, company_name: r.company_name, package: r.tender!.package, title: r.tender!.title, closing_at: r.tender!.closing_at })),
  }
}

/**
 * Accept an invitation found on /tender, signed in as its address. The link is
 * not needed: the invitation is re-keyed for this one call and accepted through
 * projects.tender_accept, which re-checks the address and that the session
 * proved the mailbox.
 */
export async function acceptPendingInvitationAction(invitationId: string): Promise<Result<{ tenderId: string }>> {
  if (!rateLimit(`tender-pending-accept:${await clientIp()}`, 10, 60_000)) return { error: 'Too many attempts. Wait a minute and try again.' }
  const supabase = (await createClient()) as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: 'Open the invitation from its email first, then press Continue.' }
  const svc = createServiceClient() as AnyClient
  const token = newInvitationToken()
  const { data: rekeyed } = await svc
    .schema('projects')
    .from('tender_invitations')
    .update({ token_hash: hashInvitationToken(token) })
    .eq('id', invitationId)
    .eq('email', user.email.toLowerCase())
    .in('status', ['prepared', 'sent'])
    .select('id')
  if (!rekeyed?.length) return { error: INVITATION_REFUSAL_TEXT.not_found }
  return acceptByHash(supabase, hashInvitationToken(token))
}

export interface PortalTender {
  id: string
  project_name: string
  package: string
  title: string
  revision: string | null
  status: string
  closing_at: string | null
  organisation_name?: string
  company_name?: string
  profile_completed_at?: string | null
}

export async function myTendersAction(): Promise<Result<PortalTender[]>> {
  const supabase = (await createClient()) as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' }
  const { data, error } = await supabase.schema('projects').rpc('tender_portal_my_tenders')
  if (error) return { error: error.message }
  return { data: (data ?? []) as PortalTender[] }
}

export interface PortalItem {
  id: string
  sort_order: number
  sheet_name: string
  row_number: number
  kind: string
  bill_code: string
  code: string | null
  description: string
  unit: string | null
  quantity: number | null
  heading_path: string[]
  rate_cell_type: string | null
  fixed_amount: number | null
  rate_column: string | null
  amount_column: string | null
}

export interface ParticipantProfile {
  company_name: string
  registration_number: string | null
  vat_number: string | null
  cidb_grade: string | null
  bbbee_level: string | null
  contact_name: string | null
  phone: string | null
  profile_completed_at: string | null
}

export async function portalTenderAction(tenderId: string): Promise<Result<{
  tender: PortalTender
  items: PortalItem[]
  requirements: { id: string; kind: string; label: string; detail: string | null; mandatory: boolean }[]
  profile: ParticipantProfile | null
}>> {
  const supabase = (await createClient()) as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' }
  const sb = supabase.schema('projects')
  const { data: summary, error } = await sb.rpc('tender_portal_summary', { p_tender_id: tenderId })
  if (error) return { error: error.message }
  const tender = (summary as PortalTender[] | null)?.[0]
  // Not a participant, or still a draft: indistinguishable from "no such tender".
  if (!tender) return { error: 'Tender not found' }
  const [{ data: items }, { data: reqs }, { data: profile }] = await Promise.all([
    sb.rpc('tender_portal_items', { p_tender_id: tenderId }),
    sb.rpc('tender_portal_requirements', { p_tender_id: tenderId }),
    sb.from('tender_participants')
      .select('company_name, registration_number, vat_number, cidb_grade, bbbee_level, contact_name, phone, profile_completed_at')
      .eq('tender_id', tenderId)
      .eq('user_id', user.id)
      .maybeSingle(),
  ])
  return { data: { tender, items: (items ?? []) as PortalItem[], requirements: reqs ?? [], profile: (profile as ParticipantProfile | null) ?? null } }
}

export async function saveProfileAction(tenderId: string, p: ProfileInput): Promise<Result<{ complete: boolean }> | { error: string; fields: Record<string, string> }> {
  const fields = validateProfile(p)
  if (Object.keys(fields).length) return { error: 'Some details need attention', fields }
  const supabase = (await createClient()) as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' }
  const { data, error } = await supabase
    .schema('projects')
    .from('tender_participants')
    .update({
      company_name: p.companyName.trim(),
      registration_number: p.registrationNumber.trim(),
      vat_number: p.vatNumber.trim() || null,
      cidb_grade: p.cidbGrade.trim().toUpperCase(),
      bbbee_level: p.bbbeeLevel.trim().toLowerCase(),
      contact_name: p.contactName.trim(),
      phone: p.phone.trim(),
      profile_completed_at: new Date().toISOString(),
    })
    .eq('tender_id', tenderId)
    .eq('user_id', user.id)
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Tender not found' }
  return { data: { complete: true } }
}
