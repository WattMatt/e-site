import 'server-only'
/**
 * Client-side access to an issued proposal (spec §9.4, D-18): by secure token (no login) or as a
 * portal user. Everything goes through 00217's SERVICE-ONLY definer functions — the raw token is
 * hashed in SQL, only the frozen snapshot is returned. The caller has already applied its own gate
 * (token shape + rate limit, or requirePortalAccess). `ClientProposalView` is what reaches the
 * browser: no storage path, no project id, and only the client projection of the snapshot
 * (toClientSnapshot: no proposal/family id, case, run id, hash or provenance).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { toClientSnapshot, type ProposalClientSnapshot, type ProposalSnapshot } from '@esite/shared/solar-reports'
import { createServiceClient } from '@/lib/supabase/server'
import { isShareToken } from './token'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Json = Record<string, unknown>

export type ClientState = 'viewed' | 'accepted' | 'declined' | 'expired' | 'withdrawn' | 'not_found'
export interface ClientProposalView {
  state: ClientState
  version: number | null
  expiresAt: string | null
  snapshot: ProposalClientSnapshot | null
  issuer: ProposalSnapshot['issuer'] | null
  response: { kind: 'accepted' | 'declined'; name: string; at: string } | null
}
export interface ResponseBody { decision: 'accepted' | 'declined'; name: string; email: string; authority: boolean; signature: string | null; reason: string | null }
export interface Meta { ip: string | null; ua: string | null }

export const RESPONSE_ERRORS: Record<string, string> = {
  invalid_name: 'Enter your full name.',
  invalid_email: 'Enter a valid email address.',
  authority_required: 'Tick the box to confirm you have authority to accept.',
  invalid_signature: 'The signature could not be read — clear it and sign again.',
  invalid_reason: 'The reason is too long (2000 characters at most).',
  expired: 'This proposal has expired.',
  withdrawn: 'This proposal has been withdrawn.',
  accepted: 'This proposal has already been accepted.',
  declined: 'This proposal has already been declined.',
  family_accepted: 'Another version of this proposal has already been accepted.',
  not_found: 'This proposal is no longer available.',
  invalid_decision: 'Something went wrong — try again.',
}

const svc = () => createServiceClient() as unknown as AnyClient
const NOT_FOUND_VIEW: ClientProposalView = { state: 'not_found', version: null, expiresAt: null, snapshot: null, issuer: null, response: null }

function toView(j: Json | null): ClientProposalView {
  if (!j || typeof j.state !== 'string') return NOT_FOUND_VIEW
  const full = (j.snapshot as ProposalSnapshot | undefined) ?? null
  const snapshot = full ? toClientSnapshot(full) : null
  const issuer = (full?.issuer ?? (j.issuer as ProposalSnapshot['issuer'] | undefined)) ?? null
  return {
    state: j.state as ClientState,
    version: typeof j.version === 'number' ? j.version : null,
    expiresAt: typeof j.expiresAt === 'string' ? j.expiresAt : null,
    snapshot,
    issuer: issuer ? { orgName: issuer.orgName, proposerName: issuer.proposerName, proposerEmail: issuer.proposerEmail } : null,
    response: (j.response as ClientProposalView['response']) ?? null,
  }
}

export async function loadProposalByToken(token: string, meta: Meta): Promise<{ view: ClientProposalView; pdfPath: string | null; projectId: string | null }> {
  if (!isShareToken(token)) return { view: NOT_FOUND_VIEW, pdfPath: null, projectId: null }
  const { data, error } = await svc().rpc('solar_proposal_by_token', { p_token: token, p_ip: meta.ip, p_ua: meta.ua })
  if (error) { console.error('[solar-proposal] token lookup failed', { code: error.code }); return { view: NOT_FOUND_VIEW, pdfPath: null, projectId: null } }
  const j = data as Json | null
  return { view: toView(j), pdfPath: (j?.pdfPath as string | undefined) ?? null, projectId: (j?.projectId as string | undefined) ?? null }
}

type RespondResult = { ok: true; state: 'accepted' | 'declined'; projectId: string; issuedBy: string | null; version: number } | { ok: false; error: string }

function mapResponse(data: unknown, error: { code?: string } | null): RespondResult {
  const j = data as Json | null
  if (error || !j) return { ok: false, error: RESPONSE_ERRORS.invalid_decision! }
  if (j.ok !== true) return { ok: false, error: RESPONSE_ERRORS[String(j.error)] ?? RESPONSE_ERRORS.invalid_decision! }
  return { ok: true, state: j.state as 'accepted' | 'declined', projectId: String(j.projectId), issuedBy: (j.issuedBy as string | null) ?? null, version: Number(j.version) }
}

export async function respondByToken(token: string, b: ResponseBody, meta: Meta): Promise<RespondResult> {
  if (!isShareToken(token)) return { ok: false, error: RESPONSE_ERRORS.not_found! }
  const { data, error } = await svc().rpc('solar_proposal_respond_by_token', {
    p_token: token, p_decision: b.decision, p_name: b.name, p_email: b.email, p_authority: b.authority,
    p_signature: b.signature, p_reason: b.reason, p_ip: meta.ip, p_ua: meta.ua,
  })
  return mapResponse(data, error)
}

export async function loadPortalProposals(projectId: string, userId: string): Promise<Json[]> {
  const { data } = await svc().rpc('solar_portal_proposals', { p_project_id: projectId, p_user_id: userId })
  return Array.isArray(data) ? (data as Json[]) : []
}

export async function loadPortalProposal(projectId: string, userId: string, proposalId: string, meta: Meta): Promise<{ view: ClientProposalView; pdfPath: string | null }> {
  const { data } = await svc().rpc('solar_portal_proposal', { p_project_id: projectId, p_user_id: userId, p_proposal_id: proposalId, p_ip: meta.ip, p_ua: meta.ua })
  const j = data as Json | null
  return { view: toView(j), pdfPath: (j?.pdfPath as string | undefined) ?? null }
}

export async function respondPortal(projectId: string, userId: string, proposalId: string, b: ResponseBody, meta: Meta): Promise<RespondResult> {
  const { data, error } = await svc().rpc('solar_portal_respond', {
    p_project_id: projectId, p_user_id: userId, p_proposal_id: proposalId, p_decision: b.decision, p_name: b.name, p_email: b.email,
    p_authority: b.authority, p_signature: b.signature, p_reason: b.reason, p_ip: meta.ip, p_ua: meta.ua,
  })
  return mapResponse(data, error)
}

/** 7-day signed download (spec §5 item 7: ≤ 7 days). */
export async function signedProposalPdfUrl(pdfPath: string, version: number): Promise<string | null> {
  const { data, error } = await svc().storage.from('reports').createSignedUrl(pdfPath, 604_800, { download: `solar-proposal-v${version}.pdf` })
  return error || !data?.signedUrl ? null : (data.signedUrl as string)
}

/** Validates a response body from an untrusted client. */
export function parseResponseBody(raw: unknown): ResponseBody | null {
  const o = raw as Json | null
  if (!o || typeof o !== 'object') return null
  if (o.decision !== 'accepted' && o.decision !== 'declined') return null
  if (typeof o.name !== 'string' || o.name.length > 300 || typeof o.email !== 'string' || o.email.length > 300) return null
  const signature = typeof o.signature === 'string' && o.signature.length <= 400_000 ? o.signature : null
  const reason = typeof o.reason === 'string' ? o.reason.slice(0, 2001) : null
  return { decision: o.decision, name: o.name, email: o.email, authority: o.authority === true, signature, reason }
}
