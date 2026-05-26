import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'E-Site — The Procedural construction platform',
  description:
    'Project management, JBCC procedural toolkit, inspections, and a verified marketplace for South African construction professionals.',
}

// Force this route to run on every request — the redirect-when-authed
// branch depends on the user's session cookie, which can't be statically
// resolved at build time.
export const dynamic = 'force-dynamic'

export default async function LandingPage() {
  // If the visitor is signed in, send them to the app. Anonymous visitors
  // see the public landing — Paystack KYC review needs this to exist.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  return (
    <>
      {/* ─── Hero ────────────────────────────────────────────────── */}
      <section
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '96px 32px 72px',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--c-amber)',
            marginBottom: 24,
          }}
        >
          Construction · Compliance · Contract administration
        </div>

        <h1
          style={{
            fontSize: 'clamp(36px, 6vw, 64px)',
            lineHeight: 1.05,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--c-text)',
            margin: 0,
            maxWidth: 880,
          }}
        >
          The procedural toolkit for South African construction work.
        </h1>

        <p
          style={{
            fontSize: 'clamp(16px, 1.6vw, 19px)',
            lineHeight: 1.55,
            color: 'var(--c-text-mid)',
            marginTop: 28,
            maxWidth: 720,
          }}
        >
          E-Site runs projects, generates JBCC notices and time-bar
          tracking, captures inspections with photographic evidence, and
          settles marketplace orders between contractors and suppliers —
          all on one platform, with the audit trail South African
          construction work actually requires.
        </p>

        <div
          style={{
            marginTop: 40,
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <Link href="/signup" className="btn-primary-amber" style={{ padding: '12px 22px', fontSize: 14 }}>
            Create an account
          </Link>
          <Link href="/pricing" className="filter-tab" style={{ padding: '11px 18px', fontSize: 13 }}>
            See pricing
          </Link>
          <Link href="/login" className="filter-tab" style={{ padding: '11px 18px', fontSize: 13 }}>
            Sign in
          </Link>
        </div>

        <div
          style={{
            marginTop: 56,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 14,
            padding: '10px 16px',
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-mid)',
            letterSpacing: '0.04em',
          }}
        >
          <span style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--c-green)',
          }} aria-hidden />
          Operating in test mode · Paystack live-mode review under way
        </div>
      </section>

      {/* ─── Feature grid ──────────────────────────────────────────── */}
      <section
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '40px 32px 88px',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--c-text-dim)',
            marginBottom: 18,
          }}
        >
          Capabilities — what ships in the box
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          <FeatureCard
            code="01 · PROJECTS"
            title="Project management"
            body="A central register of active and historical projects with site diary, snag lists, RFIs, COC tracking, floor plans, and per-project drawings. Role-based access for owners, contractors, principal agents, inspectors, and client viewers."
          />
          <FeatureCard
            code="02 · JBCC"
            title="JBCC Procedural Toolkit"
            body="Clause reference for the JBCC Principal Building Agreement, notice-letter generation against the contract's procedural framework, and tracking of every time-bar deadline so nothing lapses."
            badge="Paid module"
          />
          <FeatureCard
            code="03 · INSPECTIONS"
            title="Inspections module"
            body="Configurable inspection templates with pass / fail, numerical, and free-text entries. Inline photo capture per item, immutable templates, and PDF report generation for sign-off."
            badge="Paid module"
          />
          <FeatureCard
            code="04 · MARKETPLACE"
            title="Verified supplier marketplace"
            body="A directory of vetted construction suppliers. Contractors place orders; payment is split at settlement — supplier subaccount receives the order amount net of E-Site's 5% commission. KYC done before activation."
          />
        </div>
      </section>

      {/* ─── How it works ──────────────────────────────────────────── */}
      <section
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '40px 32px 88px',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--c-text-dim)',
            marginBottom: 18,
          }}
        >
          Process — sign-up to running site
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
          }}
        >
          <StepCard
            n="01"
            title="Sign up"
            body="Email + mobile verification. Create or join an organisation. The first project is on the Free tier — no card required."
          />
          <StepCard
            n="02"
            title="Set up a project"
            body="Parties, drawings, statutory documents, and the inspection / JBCC modules if you've unlocked them. Invite collaborators by role."
          />
          <StepCard
            n="03"
            title="Run the work"
            body="Daily site diary, inspections, snag close-out, JBCC notices with deadlines, supplier orders settled through the marketplace."
          />
          <StepCard
            n="04"
            title="Close out"
            body="Inspection PDFs, JBCC letter archive, full project audit trail. Cancellation any time — your data is preserved for 90 days post-cancellation."
          />
        </div>
      </section>

      {/* ─── CTA strip ─────────────────────────────────────────────── */}
      <section
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '0 32px 96px',
        }}
      >
        <div
          className="bracket-card"
          style={{
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            padding: 'clamp(24px, 4vw, 40px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 20,
          }}
        >
          <div style={{ maxWidth: 620 }}>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: 'var(--c-text)',
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              Free to start. Modules priced once.
            </h2>
            <p style={{ color: 'var(--c-text-mid)', marginTop: 8, lineHeight: 1.55, fontSize: 14 }}>
              Free tier covers one active project with site diary and snag tracking.
              Subscribe when you scale up; unlock JBCC or Inspections with a one-time
              payment — they stay activated for the life of the organisation.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link href="/pricing" className="filter-tab" style={{ padding: '11px 18px', fontSize: 13 }}>
              See full pricing
            </Link>
            <Link href="/signup" className="btn-primary-amber" style={{ padding: '12px 22px', fontSize: 14 }}>
              Create an account
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}

function FeatureCard({
  code, title, body, badge,
}: { code: string; title: string; body: string; badge?: string }) {
  return (
    <article
      className="bracket-card"
      style={{
        background: 'var(--c-panel)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.12em',
            color: 'var(--c-amber)',
          }}
        >
          {code}
        </div>
        {badge ? (
          <span className="badge badge-amber" style={{ whiteSpace: 'nowrap' }}>
            {badge}
          </span>
        ) : null}
      </div>
      <h3
        style={{
          fontSize: 17,
          fontWeight: 700,
          color: 'var(--c-text)',
          margin: 0,
          letterSpacing: '-0.005em',
        }}
      >
        {title}
      </h3>
      <p
        style={{
          color: 'var(--c-text-mid)',
          margin: 0,
          fontSize: 13.5,
          lineHeight: 1.55,
        }}
      >
        {body}
      </p>
    </article>
  )
}

function StepCard({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <article
      style={{
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--c-amber)',
          letterSpacing: '-0.02em',
        }}
      >
        {n}
      </div>
      <h3
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: 'var(--c-text)',
          margin: 0,
          letterSpacing: '-0.005em',
        }}
      >
        {title}
      </h3>
      <p
        style={{
          color: 'var(--c-text-mid)',
          margin: 0,
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        {body}
      </p>
    </article>
  )
}
