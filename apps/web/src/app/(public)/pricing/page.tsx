import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Pricing — E-Site',
  description:
    'E-Site subscription tiers (Free, Starter R499, Pro R999, Enterprise) plus one-time paid module unlocks for Inspections and JBCC, and the 5% marketplace commission.',
}

interface Tier {
  key:        string
  name:       string
  priceLine:  string
  cadence:    string
  blurb:      string
  features:   string[]
  cta:        { label: string; href: string }
  highlight?: boolean
}

const TIERS: Tier[] = [
  {
    key: 'free',
    name: 'Free',
    priceLine: 'R 0',
    cadence: 'forever',
    blurb: 'Run one project end-to-end without paying anything. Ideal for trying E-Site on a single job before rolling it out across a business.',
    features: [
      '1 active project',
      'Site diary + snag tracking',
      'COC tracking',
      'Document storage',
      'Up to 5 users per organisation',
      'No marketplace access',
    ],
    cta: { label: 'Create account', href: '/signup' },
  },
  {
    key: 'starter',
    name: 'Starter',
    priceLine: 'R 499',
    cadence: 'per organisation, per month',
    blurb: 'For a contractor or principal agent running multiple jobs simultaneously and needing inspection workflows and richer reporting.',
    features: [
      'Up to 3 active projects',
      'Inspections-ready (module sold separately)',
      'Basic reporting and exports',
      'COC + floor plans',
      'Up to 10 users',
      'Priority email support',
    ],
    cta: { label: 'Subscribe', href: '/signup' },
    highlight: true,
  },
  {
    key: 'pro',
    name: 'Pro',
    priceLine: 'R 999',
    cadence: 'per organisation, per month',
    blurb: 'For multi-project teams and businesses that need the marketplace, RFI module, cable schedule, and the full reporting surface.',
    features: [
      'Unlimited active projects',
      'Marketplace access (place orders + receive payouts)',
      'All reports + custom exports',
      'RFI module',
      'Cable schedule',
      'Up to 30 users',
      'Phone support',
    ],
    cta: { label: 'Subscribe', href: '/signup' },
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    priceLine: 'Custom',
    cadence: 'priced per organisation',
    blurb: 'Multi-organisation deployments, white-label, dedicated onboarding, and SLA-backed support.',
    features: [
      'Multi-organisation tenancy',
      'White-label option',
      'Dedicated customer-success manager',
      'SLA-backed uptime + support',
      'Custom integrations',
      'Unlimited users',
    ],
    cta: { label: 'Contact sales', href: `mailto:support@e-site.live?subject=Enterprise%20pricing%20enquiry` },
  },
]

interface ModuleUnlock {
  key:      string
  name:     string
  price:    string
  body:     string
}

const MODULES: ModuleUnlock[] = [
  {
    key: 'inspections',
    name: 'Inspections module',
    price: 'R 250',
    body: 'All current and future inspection templates with inline photo capture, PDF report generation, and immutability guarantees on signed-off records. Lifetime access, billed once.',
  },
  {
    key: 'jbcc',
    name: 'JBCC Procedural Toolkit',
    price: 'R 1 999',
    body: 'Clause reference for the JBCC Principal Building Agreement, notice-letter generation, and time-bar tracking. Lifetime access for the organisation, billed once.',
  },
]

export default function PricingPage() {
  return (
    <>
      {/* ─── Header ────────────────────────────────────────────────── */}
      <section
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '72px 32px 32px',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--c-amber)',
            marginBottom: 18,
          }}
        >
          Pricing
        </div>
        <h1
          style={{
            fontSize: 'clamp(32px, 5vw, 52px)',
            lineHeight: 1.05,
            fontWeight: 700,
            color: 'var(--c-text)',
            margin: 0,
            letterSpacing: '-0.02em',
          }}
        >
          Pay for what your team uses.
        </h1>
        <p
          style={{
            color: 'var(--c-text-mid)',
            fontSize: 16,
            lineHeight: 1.6,
            marginTop: 18,
            maxWidth: 720,
          }}
        >
          A subscription tier covers core project work. Inspections and the
          JBCC Procedural Toolkit are sold once per organisation — lifetime
          access, no recurring charge for those modules. The marketplace
          carries a flat 5% commission on each settled order. All prices
          are in South African Rand and include VAT.
        </p>
      </section>

      {/* ─── Subscription tiers ────────────────────────────────────── */}
      <section
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '24px 32px 32px',
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
            marginBottom: 16,
          }}
        >
          A · Platform subscription tiers
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 14,
          }}
        >
          {TIERS.map(t => (
            <article
              key={t.key}
              style={{
                background: t.highlight ? 'var(--c-amber-dim)' : 'var(--c-panel)',
                border: `1px solid ${t.highlight ? 'var(--c-amber-mid)' : 'var(--c-border)'}`,
                borderRadius: 8,
                padding: 22,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                position: 'relative',
              }}
            >
              {t.highlight ? (
                <span
                  className="badge badge-amber"
                  style={{ position: 'absolute', top: 16, right: 16 }}
                >
                  Most popular
                </span>
              ) : null}
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: t.highlight ? 'var(--c-amber)' : 'var(--c-text-dim)',
                    marginBottom: 4,
                  }}
                >
                  Tier
                </div>
                <h3
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: 'var(--c-text)',
                    margin: 0,
                  }}
                >
                  {t.name}
                </h3>
              </div>
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 30,
                    fontWeight: 700,
                    color: t.highlight ? 'var(--c-amber)' : 'var(--c-text)',
                    letterSpacing: '-0.02em',
                    lineHeight: 1,
                  }}
                >
                  {t.priceLine}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--c-text-dim)',
                    marginTop: 4,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {t.cadence}
                </div>
              </div>
              <p
                style={{
                  color: 'var(--c-text-mid)',
                  fontSize: 13,
                  lineHeight: 1.5,
                  margin: 0,
                }}
              >
                {t.blurb}
              </p>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  borderTop: '1px solid var(--c-border)',
                  paddingTop: 14,
                }}
              >
                {t.features.map((f, i) => (
                  <li
                    key={i}
                    style={{
                      color: 'var(--c-text-mid)',
                      fontSize: 13,
                      display: 'flex',
                      gap: 8,
                      alignItems: 'flex-start',
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        color: 'var(--c-amber)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    >
                      +
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 'auto', paddingTop: 6 }}>
                <Link
                  href={t.cta.href}
                  className={t.highlight ? 'btn-primary-amber' : 'filter-tab'}
                  style={{
                    width: '100%',
                    justifyContent: 'center',
                    padding: t.highlight ? '11px 18px' : '10px 16px',
                    fontSize: 13,
                  }}
                >
                  {t.cta.label}
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ─── Module unlocks ────────────────────────────────────────── */}
      <section
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '48px 32px 32px',
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
            marginBottom: 8,
          }}
        >
          B · Paid module unlocks
        </div>
        <p
          style={{
            color: 'var(--c-text-mid)',
            fontSize: 14,
            margin: '0 0 18px',
            maxWidth: 720,
          }}
        >
          One-time charge per organisation. Pays once, stays unlocked for
          the lifetime of the organisation — independent of which
          subscription tier the organisation is on.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          {MODULES.map(m => (
            <article
              key={m.key}
              className="bracket-card"
              style={{
                background: 'var(--c-panel)',
                border: '1px solid var(--c-border)',
                borderRadius: 8,
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--c-text)', margin: 0 }}>{m.name}</h3>
                <span className="badge badge-amber">One-time</span>
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 26,
                  fontWeight: 700,
                  color: 'var(--c-amber)',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                }}
              >
                {m.price}
              </div>
              <p style={{ color: 'var(--c-text-mid)', margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>
                {m.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ─── Marketplace commission ────────────────────────────────── */}
      <section
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '48px 32px 96px',
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
            marginBottom: 8,
          }}
        >
          C · Marketplace commission
        </div>

        <div
          style={{
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            padding: 24,
            display: 'grid',
            gridTemplateColumns: 'minmax(200px, 220px) 1fr',
            gap: 32,
            alignItems: 'center',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--c-text-dim)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              E-Site platform fee
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 56,
                fontWeight: 700,
                color: 'var(--c-amber)',
                letterSpacing: '-0.04em',
                lineHeight: 1,
              }}
            >
              5%
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--c-text-dim)',
                letterSpacing: '0.06em',
                marginTop: 6,
                textTransform: 'uppercase',
              }}
            >
              of order value
            </div>
          </div>
          <div style={{ color: 'var(--c-text-mid)', fontSize: 14, lineHeight: 1.6 }}>
            <p style={{ margin: '0 0 12px' }}>
              On each marketplace order, E-Site retains a flat <strong style={{ color: 'var(--c-text)' }}>5% commission</strong>{' '}
              on the order value. The remaining 95% is paid to the supplier&apos;s Paystack subaccount at
              settlement, on Paystack&apos;s standard settlement cycle.
            </p>
            <p style={{ margin: '0 0 12px' }}>
              The Paystack transaction-processing fee on each marketplace order is borne by the{' '}
              <strong style={{ color: 'var(--c-text)' }}>supplier subaccount</strong> (the recipient
              of funds). E-Site retains the full 5% — we do not absorb the Paystack fee.
            </p>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--c-text-dim)' }}>
              Example: a R 10 000 order — supplier receives R 9 500 less the Paystack processing fee;
              E-Site retains R 500.
            </p>
          </div>
        </div>
      </section>

      {/* ─── FAQ-ish strip ─────────────────────────────────────────── */}
      <section
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '0 32px 96px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          <PricingNote
            title="Currency and VAT"
            body="All prices are quoted in ZAR and include 15% VAT. South African Rand (ZAR) is the only billing currency."
          />
          <PricingNote
            title="Auto-renewal and cancellation"
            body="Subscriptions renew monthly on the date of first payment. Cancel any time from the billing page — cancellation takes effect at the end of the current period. See the Terms of Service for the full refund policy."
          />
          <PricingNote
            title="Payment provider"
            body="All payments are processed by Paystack. We never store full card numbers — Paystack tokenises them at point of sale."
          />
          <PricingNote
            title="Switching tiers"
            body="Upgrade or downgrade at any time. Upgrades are charged pro-rata from the date of change; downgrades take effect at the next renewal."
          />
        </div>
      </section>
    </>
  )
}

function PricingNote({ title, body }: { title: string; body: string }) {
  return (
    <article
      style={{
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: 18,
      }}
    >
      <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)', margin: 0, marginBottom: 8 }}>{title}</h3>
      <p style={{ color: 'var(--c-text-mid)', fontSize: 13, lineHeight: 1.55, margin: 0 }}>{body}</p>
    </article>
  )
}
