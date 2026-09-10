/**
 * Pure renderer for the GoTrue Send-Email hook.
 *
 * Split out of index.ts so it can be imported and RUN by a test — index.ts
 * pulls in `standardwebhooks` from esm.sh and reads Deno.env at module scope,
 * neither of which loads outside Deno. Nothing in this file touches Deno,
 * the network, or the environment: same input, same HTML, every time.
 */

const APP_URL = 'https://www.e-site.live'

export interface HookPayload {
  user: { email: string; email_change?: string; user_metadata?: { full_name?: string } }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: string
    token_new?: string
    token_hash_new?: string
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function baseTemplate(content: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:32px}
  .card{background:#1E293B;border:1px solid #334155;border-radius:12px;padding:28px;max-width:480px;margin:0 auto}
  h2{color:#fff;font-size:18px;margin:0 0 12px}p{font-size:14px;line-height:1.6;color:#94A3B8;margin:0 0 12px}
  .btn{display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px;margin:8px 0 4px}
  .otp{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:26px;letter-spacing:0.35em;color:#F1F5F9;background:#0F172A;border:1px solid #334155;border-radius:8px;padding:12px 16px;text-align:center;margin:12px 0}
  .note{font-size:12px;color:#64748B;line-height:1.6}
  .footer{margin-top:24px;font-size:11px;color:#475569;text-align:center}</style></head>
  <body><div class="card">${content}<div class="footer">E-Site Construction Management · <a href="${APP_URL}" style="color:#3B82F6">www.e-site.live</a></div></div></body></html>`
}

/** token_hash link into the app's own callback (server-side verifyOtp). */
export function appLink(tokenHash: string, otpType: string, next: string): string {
  return `${APP_URL}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(otpType)}&next=${encodeURIComponent(next)}`
}

export function codeBlock(token: string, label = 'Or enter this 6-digit code where prompted:'): string {
  return `<p class="note">${label}</p><div class="otp">${escapeHtml(token)}</div>`
}

/** UTC stamp for notification mail — "when did this happen" in one glance. */
export function formatStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

/**
 * A GoTrue *notification* ("your password was changed", "an identity was
 * linked") arrives with `token: ""` — there is nothing for the recipient to
 * verify. Rendering the verification layout for one produces an empty code
 * box under the heading "Your verification code" and a promise that a code
 * that does not exist expires in 24 hours.
 */
function notificationEmail(
  email: string,
  heading: string,
  body: string,
): { to: string; subject: string; html: string } {
  return {
    to: email,
    subject: heading,
    html: baseTemplate(`
      <h2>${escapeHtml(heading)}</h2>
      ${body}
      <p>If this wasn't you, reset your password now and then contact support.</p>
      <a class="btn" href="${APP_URL}/reset-password">Reset my password</a>
      <p class="note">This message is a notification only. There is no code to enter
        and no link in it that changes anything on its own.</p>`),
  }
}

/** Render subject + html for a GoTrue email action. */
export function renderAuthEmail(
  p: HookPayload,
  now: Date = new Date(),
): { to: string; subject: string; html: string } {
  const { token, token_hash, email_action_type } = p.email_data
  const email = p.user.email
  const expiry = '24 hours'
  const expiryNote = `<p class="note">This code and link expire in about ${expiry} and can be used once.
    If they expire, request a fresh one from the same screen.</p>`

  switch (email_action_type) {
    case 'recovery':
      return {
        to: email,
        subject: 'Reset your E-Site password',
        html: baseTemplate(`
          <h2>Reset your password</h2>
          <p>A password reset was requested for <strong>${escapeHtml(email)}</strong>.
             If this wasn't you, you can safely ignore this email.</p>
          ${codeBlock(token, 'Enter this 6-digit code on the reset screen:')}
          <p>Or reset in one click:</p>
          <a class="btn" href="${appLink(token_hash, 'recovery', '/reset-password/confirm')}">Set a new password</a>
          ${expiryNote}`),
      }
    case 'magiclink':
      return {
        to: email,
        subject: 'Your E-Site sign-in code',
        html: baseTemplate(`
          <h2>Sign in to E-Site</h2>
          <p>Use this code to finish signing in as <strong>${escapeHtml(email)}</strong>:</p>
          ${codeBlock(token, '')}
          <p>Or sign in with one click:</p>
          <a class="btn" href="${appLink(token_hash, 'magiclink', '/dashboard')}">Sign in</a>
          ${expiryNote}`),
      }
    case 'signup':
      return {
        to: email,
        subject: 'Confirm your E-Site signup',
        html: baseTemplate(`
          <h2>Confirm your signup</h2>
          <p>Confirm <strong>${escapeHtml(email)}</strong> to activate your E-Site account.</p>
          ${codeBlock(token, 'Your confirmation code:')}
          <a class="btn" href="${appLink(token_hash, 'signup', '/dashboard')}">Confirm my email</a>
          ${expiryNote}`),
      }
    case 'invite':
      // Not used by the app (invites go through the branded sendInviteEmail
      // pipeline), but handled so a Studio-triggered invite still works.
      return {
        to: email,
        subject: 'You have been invited to E-Site',
        html: baseTemplate(`
          <h2>You've been invited to E-Site</h2>
          <p>Set a password for <strong>${escapeHtml(email)}</strong> to get started.</p>
          ${codeBlock(token, 'Your invite code:')}
          <a class="btn" href="${appLink(token_hash, 'invite', '/reset-password/confirm')}">Set your password</a>
          ${expiryNote}`),
      }
    case 'email_change_current': {
      // Secure email change, step 1: confirm from the CURRENT address.
      return {
        to: email,
        subject: 'Confirm your E-Site email change',
        html: baseTemplate(`
          <h2>Confirm your email change</h2>
          <p>You asked to change the email on your E-Site account. Enter this code to confirm from your current address:</p>
          ${codeBlock(token, '')}
          ${expiryNote}`),
      }
    }
    case 'email_change': {
      const to = p.user.email_change || email
      return {
        to,
        subject: 'Confirm your new E-Site email address',
        html: baseTemplate(`
          <h2>Confirm your new email</h2>
          <p>Enter this code in E-Site to confirm <strong>${escapeHtml(to)}</strong> as your new address:</p>
          ${codeBlock(token, '')}
          ${expiryNote}`),
      }
    }
    case 'password_changed_notification':
      // GoTrue emits this with token:"" once mailer_notifications_password_
      // changed_enabled is on. Falling through to the default branch would
      // mail a security alert headed "Your verification code" with an empty
      // code box — the one email a user reads carefully, rendered broken.
      return notificationEmail(
        email,
        'Your E-Site password was changed',
        `<p>The password for <strong>${escapeHtml(email)}</strong> was changed on
           <strong>${escapeHtml(formatStamp(now))}</strong>.</p>
         <p>Every other session was signed out. If you made this change, nothing
            more is needed.</p>`,
      )
    case 'reauthentication':
      return {
        to: email,
        subject: 'Your E-Site verification code',
        html: baseTemplate(`
          <h2>Verify it's you</h2>
          <p>Enter this code to confirm the action on your E-Site account:</p>
          ${codeBlock(token, '')}
          <p class="note">If you didn't request this, you can ignore it.</p>`),
      }
    default:
      // Unknown/new action type: deliver something usable rather than fail —
      // but "usable" depends on whether there is a token. GoTrue keeps adding
      // notification actions (identity linked, MFA enrolled, phone changed),
      // and every one of them carries token:"". Only render the code layout
      // when there is actually a code.
      if (!token || email_action_type.endsWith('_notification')) {
        return notificationEmail(
          email,
          'Your E-Site account was changed',
          `<p>A change was made to the E-Site account for
             <strong>${escapeHtml(email)}</strong> on
             <strong>${escapeHtml(formatStamp(now))}</strong>.</p>`,
        )
      }
      return {
        to: email,
        subject: 'Your E-Site verification code',
        html: baseTemplate(`
          <h2>Your verification code</h2>
          ${codeBlock(token, '')}
          ${expiryNote}`),
      }
  }
}
