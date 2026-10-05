/**
 * /auth/wa-link/<token> — a signed link sent over WhatsApp (E4). GET only shows a button, so a
 * link preview or scanner that fetches the URL consumes nothing; the button POSTs the server
 * action, which consumes the token once and signs the person in (lib/whatsapp-forms/wa-link.ts).
 */
import { redirect } from 'next/navigation'
import { consumeWaLink } from '@/lib/whatsapp-forms/wa-link'
import { waLinkDeps } from '@/lib/whatsapp-forms/wa-link-server'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Open in E-Site', robots: { index: false, follow: false } }

const MESSAGES: Record<string, string> = {
  expired: 'This link has expired or was already used. Send MENU on WhatsApp and open the inspection again for a new one.',
  not_available: 'This inspection is not available to you any more.',
  sign_in_failed: 'We could not sign you in from this link. Send MENU on WhatsApp and try again.',
}

export default async function WaLinkPage({ params, searchParams }: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ e?: string }>
}) {
  const { token } = await params
  const { e } = await searchParams

  async function open() {
    'use server'
    const r = await consumeWaLink(token, waLinkDeps())
    if (r.ok) redirect(r.redirectTo)
    redirect(`/auth/wa-link/${encodeURIComponent(token)}?e=${r.reason}`)
  }

  const message = e ? MESSAGES[e] ?? MESSAGES.expired : null
  return (
    <main style={{ maxWidth: 420, margin: '0 auto', padding: '48px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>Open the inspection in E-Site</h1>
      {message ? (
        <p role="alert" style={{ lineHeight: 1.5 }}>{message}</p>
      ) : (
        <>
          <p style={{ lineHeight: 1.5, marginBottom: 24 }}>
            This link signs you in to E-Site as yourself and opens the inspection you were working on in WhatsApp.
            It works once, for 15 minutes.
          </p>
          <form action={open}>
            <button type="submit" style={{ width: '100%', padding: '14px 16px', fontSize: 16, fontWeight: 600, borderRadius: 8,
              border: 'none', background: '#0a5f4e', color: '#fff', cursor: 'pointer' }}>
              Continue
            </button>
          </form>
        </>
      )}
    </main>
  )
}
