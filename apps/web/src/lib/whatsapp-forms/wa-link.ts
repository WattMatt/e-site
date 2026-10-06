/**
 * Signed WhatsApp links into the web form (E4, D5).
 *
 * The form service sends a person a link `/auth/wa-link/<token>` (32 random bytes, stored only as a
 * SHA-256 in whatsapp.form_links, single use, 15 minutes) when a form cannot be finished in chat:
 * a signature, a file, a long table. Opening the link shows a Continue button; only the POST
 * consumes it, so WhatsApp's link preview and mail-style scanners cannot burn it (the PR #140
 * lesson). Consuming it re-checks the person's project role NOW, then mints a normal session for
 * that person (generateLink + verifyOtp, server-side; the GoTrue token never reaches a URL) and
 * redirects to the inspection page. Everything after that is the ordinary web app under RLS; the
 * MFA gate in middleware still applies to an aal1 session.
 */
export interface WaLinkDeps {
  hash(token: string): string
  /** Atomically mark the link consumed if unconsumed and unexpired; returns its row or null. */
  consume(tokenHash: string): Promise<{ user_id: string; target_path: string } | null>
  projectRole(projectId: string, userId: string): Promise<string | null>
  emailFor(userId: string): Promise<string | null>
  /** auth.admin.generateLink({ type: 'magiclink' }) -> properties.hashed_token. Sends nothing. */
  magicLinkHash(email: string): Promise<string | null>
  /** verifyOtp({ token_hash, type: 'magiclink' }) on the cookie client; true when a session was set. */
  signIn(tokenHash: string): Promise<boolean>
  audit(userId: string): Promise<void>
}

export type WaLinkResult = { ok: true; redirectTo: string } | { ok: false; reason: 'expired' | 'not_available' | 'sign_in_failed' }

const TOKEN = /^[A-Za-z0-9_-]{32,128}$/
const TARGET = /^\/projects\/([0-9a-f-]{36})\/inspections\/[0-9a-f-]{36}$/

export async function consumeWaLink(token: string, d: WaLinkDeps): Promise<WaLinkResult> {
  if (!TOKEN.test(token)) return { ok: false, reason: 'expired' }
  const row = await d.consume(d.hash(token))
  if (!row) return { ok: false, reason: 'expired' }
  const m = TARGET.exec(row.target_path)
  if (!m) return { ok: false, reason: 'not_available' }
  const role = await d.projectRole(m[1], row.user_id)
  if (!role || role === 'client_viewer') return { ok: false, reason: 'not_available' }
  const email = await d.emailFor(row.user_id)
  const hashed = email ? await d.magicLinkHash(email) : null
  if (!hashed || !(await d.signIn(hashed))) return { ok: false, reason: 'sign_in_failed' }
  await d.audit(row.user_id)
  return { ok: true, redirectTo: row.target_path }
}
