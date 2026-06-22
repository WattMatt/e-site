import type { AuthHookPayload, OrgBranding } from './types.ts'
import { PLATFORM_NAME } from './types.ts'
import { brandedTemplate, escape } from '../email-templates/branded.ts'

export interface BuildOpts {
  siteUrl: string
  /** Org co-branding for invites; null for account-level mail (reset/signup). */
  org: OrgBranding | null
}

export interface BuiltEmail {
  to: string
  subject: string
  html: string
}

function link(siteUrl: string, path: string, type: string, tokenHash: string): string {
  // /accept-invite consumes token directly; the others route through
  // /auth/callback which already handles verifyOtp({ token_hash, type }).
  if (path === '/accept-invite') {
    return `${siteUrl}/accept-invite?token_hash=${tokenHash}&type=${type}`
  }
  return `${siteUrl}${path}&token_hash=${tokenHash}&type=${type}`
}

export function buildAuthEmail(payload: AuthHookPayload, opts: BuildOpts): BuiltEmail {
  const { siteUrl, org } = opts
  const { token, token_hash, email_action_type } = payload.email_data
  const to = payload.user.email
  const meta = payload.user.user_metadata ?? {}

  const codeBlock = (label: string) => `
    <p style="margin:16px 0 0;font-size:13px;color:#5B6472">${label}</p>
    <p style="margin:6px 0 0;font-size:24px;font-weight:700;letter-spacing:6px;color:#1A1F2B">${escape(token)}</p>`

  switch (email_action_type) {
    case 'invite': {
      const role = typeof meta.invited_role === 'string' ? meta.invited_role : null
      const site = typeof meta.site_name === 'string' ? meta.site_name : null
      const orgName = (typeof meta.org_name === 'string' && meta.org_name) || org?.name || 'your team'
      const inviter = typeof meta.inviter_name === 'string' ? meta.inviter_name : null
      const ctaHref = link(siteUrl, '/accept-invite', 'invite', token_hash)
      const roleLine = role ? ` as a <strong>${escape(role)}</strong>` : ''
      const siteLine = site ? `, to review <strong>${escape(site)}</strong>` : ''
      const inviterLine = inviter ? `<strong>${escape(inviter)}</strong> invited you` : 'You have been invited'
      return {
        to,
        subject: `You've been invited to ${orgName === 'your team' ? PLATFORM_NAME : orgName}`,
        html: brandedTemplate({
          org,
          heading: 'Accept your invitation',
          bodyHtml: `<p>${inviterLine} to join <strong>${escape(orgName)}</strong> on ${escape(PLATFORM_NAME)}${roleLine}${siteLine}.</p>
            <p>Click below to accept and set your password.</p>
            ${codeBlock('Or use this one-time code on the set-password page:')}`,
          ctaLabel: 'Accept invitation & set password',
          ctaHref,
          expiryLabel: 'This invitation expires in 60 minutes.',
          fallbackLink: ctaHref,
          siteUrl,
        }),
      }
    }
    case 'recovery': {
      const ctaHref = link(siteUrl, '/auth/callback?next=/reset-password/confirm', 'recovery', token_hash)
      return {
        to,
        subject: 'Reset your password',
        html: brandedTemplate({
          org,
          heading: 'Reset your password',
          bodyHtml: `<p>We received a request to reset your ${escape(PLATFORM_NAME)} password. Click below to choose a new one.</p>
            ${codeBlock('Or enter this one-time code on the set-password page:')}`,
          ctaLabel: 'Reset password',
          ctaHref,
          expiryLabel: 'This link and code expire in 60 minutes.',
          fallbackLink: ctaHref,
          siteUrl,
        }),
      }
    }
    case 'signup': {
      const ctaHref = link(siteUrl, '/auth/callback?next=/onboarding', 'signup', token_hash)
      return {
        to,
        subject: `Confirm your ${PLATFORM_NAME} account`,
        html: brandedTemplate({
          org,
          heading: 'Confirm your account',
          bodyHtml: `<p>Welcome to ${escape(PLATFORM_NAME)}. Confirm your email to activate your account.</p>`,
          ctaLabel: 'Confirm account',
          ctaHref,
          expiryLabel: 'This link expires in 60 minutes.',
          fallbackLink: ctaHref,
          siteUrl,
        }),
      }
    }
    case 'magiclink': {
      const ctaHref = link(siteUrl, '/auth/callback?next=/dashboard', 'magiclink', token_hash)
      return {
        to,
        subject: `Your ${PLATFORM_NAME} sign-in link`,
        html: brandedTemplate({
          org,
          heading: `Sign in to ${PLATFORM_NAME}`,
          bodyHtml: `<p>Click below to sign in. This link is single-use.</p>`,
          ctaLabel: 'Sign in',
          ctaHref,
          expiryLabel: 'This link expires in 60 minutes.',
          fallbackLink: ctaHref,
          siteUrl,
        }),
      }
    }
    case 'email_change': {
      const ctaHref = link(siteUrl, '/auth/callback?next=/dashboard', 'email_change', token_hash)
      return {
        to,
        subject: 'Confirm your new email address',
        html: brandedTemplate({
          org,
          heading: 'Confirm your new email',
          bodyHtml: `<p>Confirm this address to finish changing your ${escape(PLATFORM_NAME)} email.</p>`,
          ctaLabel: 'Confirm new email',
          ctaHref,
          expiryLabel: 'This link expires in 60 minutes.',
          fallbackLink: ctaHref,
          siteUrl,
        }),
      }
    }
    default: {
      // Exhaustiveness guard — unknown action types fail loud rather than send junk.
      throw new Error(`Unsupported email_action_type: ${String(email_action_type)}`)
    }
  }
}
