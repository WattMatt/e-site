'use server'

/**
 * The tenderer side (E5 slice B). A tenderer is an auth user with no
 * organisation; everything they read comes through the column-limited
 * projects.tender_portal_* functions (00243), and the only row they write is
 * their own participant profile.
 *
 * Accepting never creates a session from the invitation link. The link holder
 * can only ask for a sign-in link to be emailed to the invited address; the
 * invitation is accepted afterwards, signed in AS that address, by
 * projects.tender_accept (one transaction, re-checking everything).
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
} from '@/lib/tender/invitation'
import { splitEmails } from '@/lib/tender/parse-tender-list'
import { validateProfile, type ProfileInput } from '@/lib/tender/profile'

type Result<T> = { data: T } | { error: string }

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.e-site.live').replace(/\/$/, '')

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

/**
 * Step 1: email a sign-in link to the INVITED address (never to anyone else),
 * returning to this invitation. Creates the account if the address has none;
 * the link both confirms the address and signs in. Same answer every time, so
 * it reveals nothing about whether an account exists.
 */
export async function sendInvitationSignInAction(token: string): Promise<Result<{ email: string }>> {
  if (!rateLimit(`tender-invite-signin:${await clientIp()}`, 5, 60_000)) return { error: 'Too many requests. Wait a minute and try again.' }
  const found = await lookup(token)
  const check = checkInvitation(found?.invitation ?? null, found?.tender ?? null, new Date())
  if (!check.ok) return { error: INVITATION_REFUSAL_TEXT[check.reason] }
  const supabase = await createClient()
  await supabase.auth.signInWithOtp({
    email: found!.invitation.email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(`/tender/invite/${token}`)}`,
    },
  })
  return { data: { email: found!.invitation.email } }
}

/** Step 2: accept, signed in as the invited address. */
export async function acceptInvitationAction(token: string): Promise<Result<{ tenderId: string }>> {
  if (!rateLimit(`tender-invite-accept:${await clientIp()}`, 10, 60_000)) return { error: 'Too many attempts. Wait a minute and try again.' }
  if (!looksLikeInvitationToken(token)) return { error: INVITATION_REFUSAL_TEXT.not_found }
  const supabase = (await createClient()) as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in first: use the link we emailed to the invited address.' }
  const { data, error } = await supabase.schema('projects').rpc('tender_accept', { p_token_hash: hashInvitationToken(token) })
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

/** Return visits: email a sign-in link. Always answers the same way (no account probing). */
export async function requestTenderSignInAction(email: string): Promise<Result<true>> {
  if (!rateLimit(`tender-signin:${await clientIp()}`, 5, 60_000)) return { error: 'Too many requests. Wait a minute and try again.' }
  const { valid } = splitEmails(email)
  if (valid.length !== 1) return { error: 'Enter the email address your invitation was sent to' }
  const supabase = await createClient()
  await supabase.auth.signInWithOtp({
    email: valid[0],
    options: { shouldCreateUser: false, emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent('/tender')}` },
  })
  return { data: true }
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
