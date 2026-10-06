'use server'

/**
 * Tender invitations, WM side (E5 slice B). Gated on ORG_WRITE_ROLES for the
 * tender's project before any read or write; table access runs under row
 * security through the caller's cookie client.
 *
 * An invitation link is shown ONCE, to the WM user who prepares (or
 * regenerates) it; only its SHA-256 is stored. Sending invitation emails to
 * contractors is an owner decision, so `sendTenderInvitationsAction` refuses
 * unless TENDER_INVITES_ENABLED=true (shipped unset).
 */

import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { DEFAULT_ACCENT_COLOR, escapeHtml, filterSuppressed, renderBrandedEmail } from '@esite/shared'
import { gateTender, tenderInvitesEnabled, tenderPrefix, type AnyClient } from '@/lib/tender/gate'
import { hashInvitationToken, invitationExpiry, newInvitationToken } from '@/lib/tender/invitation'
import { parseTenderList, splitEmails, type ParsedTenderList } from '@/lib/tender/parse-tender-list'

type Result<T> = { data: T } | { error: string }

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.e-site.live').replace(/\/$/, '')
const inviteLink = (token: string) => `${siteUrl()}/tender/invite/${token}`

export interface InvitationRow {
  id: string
  company_name: string
  contact_name: string | null
  email: string
  phone: string | null
  source: string
  status: string
  token_expires_at: string | null
  sent_at: string | null
  accepted_at: string | null
  created_at: string
}

const INVITATION_COLUMNS =
  'id, company_name, contact_name, email, phone, source, status, token_expires_at, sent_at, accepted_at, created_at'

function bust(projectId: string, tenderId: string) {
  revalidatePath(`/projects/${projectId}/tenders/${tenderId}`, 'page')
  revalidatePath(`/projects/${projectId}/tenders`, 'page')
}

export async function issueTenderAction(tenderId: string, closingAtIso: string): Promise<Result<true>> {
  const closing = new Date(closingAtIso)
  if (Number.isNaN(closing.getTime())) return { error: 'Closing time is not a valid date' }
  if (closing.getTime() <= Date.now() + 60 * 60 * 1000) return { error: 'The closing time must be at least an hour from now' }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  if (g.tender.status !== 'draft') return { error: 'Only a draft tender can be issued' }
  const { data, error } = await g.supabase
    .schema('projects')
    .from('tenders')
    .update({ status: 'issued', closing_at: closing.toISOString() })
    .eq('id', tenderId)
    .eq('status', 'draft')
    .select('id')
  // The database refuses an issue without an imported BOQ, a future closing time
  // and an amount on every fixed sum; its message is shown as written.
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Nothing was changed (the tender may already be issued)' }
  // Links prepared while it was a draft now live until the closing time
  // (which governs, and may be extended), so they carry no expiry of their own.
  await g.supabase
    .schema('projects')
    .from('tender_invitations')
    .update({ token_expires_at: null })
    .eq('tender_id', tenderId)
    .in('status', ['prepared', 'sent'])
  bust(g.tender.project_id, tenderId)
  return { data: true }
}

export async function listInvitationsAction(tenderId: string): Promise<Result<InvitationRow[]>> {
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  const { data, error } = await g.supabase
    .schema('projects')
    .from('tender_invitations')
    .select(INVITATION_COLUMNS)
    .eq('tender_id', tenderId)
    .order('created_at')
  if (error) return { error: error.message }
  return { data: (data ?? []) as InvitationRow[] }
}

export interface Invitee {
  companyName: string
  contactName?: string | null
  email: string
  phone?: string | null
}

/**
 * Create invitations in `prepared` state and return each one's link ONCE.
 * Rejected rows (bad or duplicate email) are reported, never guessed.
 */
export async function prepareInvitationsAction(
  tenderId: string,
  invitees: Invitee[],
  source: 'manual' | 'tender_list' = 'manual',
): Promise<Result<{ prepared: { id: string; email: string; link: string }[]; rejected: { email: string; reason: string }[] }>> {
  if (!Array.isArray(invitees) || invitees.length === 0) return { error: 'Add at least one company' }
  if (invitees.length > 100) return { error: 'Prepare at most 100 invitations at a time' }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  if (g.tender.status !== 'draft' && g.tender.status !== 'issued') return { error: 'This tender is no longer open' }

  const expires = invitationExpiry(g.tender.closing_at, new Date())
  const rejected: { email: string; reason: string }[] = []
  const rows: Record<string, unknown>[] = []
  const tokens = new Map<string, string>()
  for (const inv of invitees) {
    const company = (inv.companyName ?? '').trim()
    const { valid } = splitEmails(inv.email)
    if (!company) {
      rejected.push({ email: inv.email, reason: 'company name is required' })
      continue
    }
    if (valid.length !== 1) {
      rejected.push({ email: inv.email, reason: valid.length === 0 ? 'not a valid email address' : 'one email address per invitation' })
      continue
    }
    if (tokens.has(valid[0])) {
      rejected.push({ email: valid[0], reason: 'listed twice' })
      continue
    }
    const token = newInvitationToken()
    tokens.set(valid[0], token)
    rows.push({
      tender_id: tenderId,
      company_name: company,
      contact_name: inv.contactName?.trim() || null,
      email: valid[0],
      phone: inv.phone?.trim() || null,
      source,
      token_hash: hashInvitationToken(token),
      token_expires_at: expires,
    })
  }

  const prepared: { id: string; email: string; link: string }[] = []
  for (const row of rows) {
    // One insert per row so a duplicate (already invited) rejects only itself.
    const { data, error } = await g.supabase.schema('projects').from('tender_invitations').insert(row).select('id, email').single()
    if (error) {
      rejected.push({ email: row.email as string, reason: error.code === '23505' ? 'already invited to this tender' : error.message })
      continue
    }
    prepared.push({ id: data.id, email: data.email, link: inviteLink(tokens.get(data.email)!) })
  }
  bust(g.tender.project_id, tenderId)
  return { data: { prepared, rejected } }
}

async function gateInvitation(invitationId: string) {
  // Read AS THE CALLER (row security + site_scope), never the service key first:
  // an invitation on a tender the caller may not manage reads as not found.
  const supabase = (await createClient()) as AnyClient
  const { data: inv } = await supabase
    .schema('projects')
    .from('tender_invitations')
    .select('id, tender_id, status, email, company_name')
    .eq('id', invitationId)
    .maybeSingle()
  if (!inv) return { ok: false as const, error: 'Invitation not found' }
  const g = await gateTender(inv.tender_id)
  if (!g.ok) return g
  return { ...g, invitation: inv as { id: string; tender_id: string; status: string; email: string; company_name: string } }
}

/** A new link for a prepared/sent invitation; the old link stops working. */
export async function regenerateInvitationLinkAction(invitationId: string): Promise<Result<{ link: string }>> {
  const g = await gateInvitation(invitationId)
  if (!g.ok) return { error: g.error }
  if (!['prepared', 'sent'].includes(g.invitation.status)) return { error: 'Only an invitation that has not been accepted can get a new link' }
  const token = newInvitationToken()
  const { data, error } = await g.supabase
    .schema('projects')
    .from('tender_invitations')
    .update({ token_hash: hashInvitationToken(token), token_expires_at: invitationExpiry(g.tender.closing_at, new Date()) })
    .eq('id', invitationId)
    .eq('tender_id', g.tender.id)
    .in('status', ['prepared', 'sent'])
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Nothing was changed' }
  bust(g.tender.project_id, g.tender.id)
  return { data: { link: inviteLink(token) } }
}

export async function revokeInvitationAction(invitationId: string): Promise<Result<true>> {
  const g = await gateInvitation(invitationId)
  if (!g.ok) return { error: g.error }
  if (!['prepared', 'sent'].includes(g.invitation.status)) return { error: 'An accepted invitation cannot be withdrawn here' }
  const { data, error } = await g.supabase
    .schema('projects')
    .from('tender_invitations')
    .update({ status: 'revoked', token_hash: null })
    .eq('id', invitationId)
    .eq('tender_id', g.tender.id)
    .in('status', ['prepared', 'sent'])
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Nothing was changed' }
  bust(g.tender.project_id, g.tender.id)
  return { data: true }
}

/** Read an uploaded SUB-CONTRACTORS TENDER LIST.xlsx (stored under this tender's folder). */
export async function readTenderListAction(tenderId: string, path: string): Promise<Result<ParsedTenderList>> {
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  // Only a tender-list upload of THIS tender may be read, and it is deleted
  // afterwards: never the frozen BOQ or estimate workbooks in the same folder.
  const prefix = tenderPrefix(g.tender)
  if (!path.startsWith(`${prefix}list-`) || !/^list-\d+-[A-Za-z0-9._-]+\.(xlsx|xlsm)$/.test(path.slice(prefix.length))) {
    return { error: 'That file is not a tender list upload of this tender' }
  }
  const svc = createServiceClient() as AnyClient
  const { data, error } = await svc.storage.from('tender-files').download(path)
  if (error || !data) return { error: 'The tender list did not arrive. Upload it again.' }
  try {
    return { data: await parseTenderList(new Uint8Array(await (data as Blob).arrayBuffer())) }
  } catch (e) {
    return { error: `Could not read the tender list: ${e instanceof Error ? e.message : 'unknown error'}` }
  } finally {
    await svc.storage.from('tender-files').remove([path])
  }
}

/**
 * OWNER-GATED: emails invitation links to contractors. Refuses unless
 * TENDER_INVITES_ENABLED=true. Each send mints a fresh link (the old one stops
 * working) because the raw token is never stored.
 */
export async function sendTenderInvitationsAction(tenderId: string, invitationIds: string[]): Promise<Result<{ sent: number; skipped: string[] }>> {
  if (!tenderInvitesEnabled()) {
    return { error: 'Sending invitations is switched off. Copy each link instead, or ask the owner to switch sending on.' }
  }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  if (g.tender.status !== 'issued') return { error: 'Issue the tender (set its closing time) before sending invitations' }
  const svc = createServiceClient() as AnyClient
  const { data: invs } = await g.supabase
    .schema('projects')
    .from('tender_invitations')
    .select('id, email, company_name, contact_name, status')
    .eq('tender_id', tenderId)
    .in('id', invitationIds)
    .in('status', ['prepared', 'sent'])
  const { data: org } = await svc.from('organisations').select('name').eq('id', g.tender.organisation_id).maybeSingle()
  const orgName = (org as { name?: string } | null)?.name ?? 'The engineer'
  const { data: proj } = await svc.schema('projects').from('projects').select('name').eq('id', g.tender.project_id).maybeSingle()
  const projectName = (proj as { name?: string } | null)?.name ?? ''
  const { allowed } = await filterSuppressed(svc as never, (invs ?? []).map((i: { email: string }) => i.email))
  const skipped: string[] = []
  let sent = 0
  for (const inv of (invs ?? []) as { id: string; email: string; company_name: string; contact_name: string | null }[]) {
    if (!allowed.includes(inv.email)) {
      skipped.push(`${inv.email} (unsubscribed or bouncing)`)
      continue
    }
    const token = newInvitationToken()
    const { error: upErr } = await g.supabase
      .schema('projects')
      .from('tender_invitations')
      .update({ token_hash: hashInvitationToken(token), token_expires_at: null, status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', inv.id)
    if (upErr) {
      skipped.push(`${inv.email} (${upErr.message})`)
      continue
    }
    const closes = g.tender.closing_at ? new Date(g.tender.closing_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }) : ''
    const html = renderBrandedEmail({
      accentColor: DEFAULT_ACCENT_COLOR,
      logoUrl: null,
      projectName,
      title: `Invitation to tender: ${g.tender.package}`,
      contentHtml:
        `<p>${escapeHtml(inv.contact_name ? `Dear ${inv.contact_name},` : 'Good day,')}</p>` +
        `<p>${escapeHtml(orgName)} invites ${escapeHtml(inv.company_name)} to tender for <strong>${escapeHtml(g.tender.package)} — ${escapeHtml(g.tender.title)}</strong>.</p>` +
        `<p><a href="${escapeHtml(inviteLink(token))}">Open the tender</a> to register your company, price the bill of quantities and upload the requested documents.</p>` +
        `<p>Tenders close ${escapeHtml(closes)}. This link is personal to you — please do not forward it.</p>`,
      siteUrl: siteUrl(),
    })
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ type: 'rfi-created', payload: { to: [inv.email], subject: `Invitation to tender: ${g.tender.package} — ${g.tender.title}`, html } }),
    }).catch(() => null)
    if (!res || !res.ok) skipped.push(`${inv.email} (email service refused)`)
    else sent += 1
  }
  bust(g.tender.project_id, tenderId)
  return { data: { sent, skipped } }
}
