import type { ReactNode } from 'react'

// Shared chrome for the three public legal pages (AUP, Privacy, Terms).
// Keeps the title block + content column consistent and styles the standard
// HTML elements (h2, h3, p, ul, ol) without prop-drilling per page.

interface Props {
  eyebrow:     string
  title:       string
  effective:   string   // human-readable, e.g. "25 May 2026"
  version?:    string
  children:    ReactNode
}

export function LegalPage({ eyebrow, title, effective, version, children }: Props) {
  return (
    <>
      <section
        style={{
          maxWidth: 820,
          margin: '0 auto',
          padding: '72px 32px 24px',
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
          {eyebrow}
        </div>
        <h1
          style={{
            fontSize: 'clamp(28px, 4vw, 40px)',
            lineHeight: 1.1,
            fontWeight: 700,
            color: 'var(--c-text)',
            margin: 0,
            letterSpacing: '-0.02em',
          }}
        >
          {title}
        </h1>
        <div
          style={{
            display: 'flex',
            gap: 18,
            marginTop: 18,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            flexWrap: 'wrap',
          }}
        >
          <span>Effective: {effective}</span>
          {version ? <span>· {version}</span> : null}
        </div>
      </section>

      <section
        style={{
          maxWidth: 820,
          margin: '0 auto',
          padding: '12px 32px 96px',
          lineHeight: 1.7,
          color: 'var(--c-text-mid)',
          fontSize: 15,
        }}
        className="legal-body"
      >
        {children}
      </section>

      {/* Scoped styles for content rendered inside .legal-body. Scoped via the
          class so they don't leak elsewhere on the public site. */}
      <style>{`
        .legal-body h2 {
          color: var(--c-text);
          font-size: 20px;
          font-weight: 700;
          margin: 40px 0 12px;
          letter-spacing: -0.01em;
          padding-top: 12px;
          border-top: 1px solid var(--c-border);
        }
        .legal-body h2:first-of-type { border-top: none; padding-top: 0; margin-top: 24px; }
        .legal-body h3 {
          color: var(--c-text);
          font-size: 15px;
          font-weight: 700;
          margin: 24px 0 8px;
          letter-spacing: 0;
        }
        .legal-body p { margin: 0 0 14px; }
        .legal-body ul, .legal-body ol {
          margin: 0 0 16px;
          padding-left: 22px;
        }
        .legal-body li { margin-bottom: 8px; }
        .legal-body strong { color: var(--c-text); font-weight: 600; }
        .legal-body a { color: var(--c-amber); text-decoration: underline; text-underline-offset: 2px; }
        .legal-body a:hover { opacity: 0.85; }
        .legal-body code,
        .legal-body .mono {
          font-family: var(--font-mono);
          font-size: 13px;
          color: var(--c-text);
          background: var(--c-panel);
          border: 1px solid var(--c-border);
          padding: 1px 6px;
          border-radius: 4px;
        }
        .legal-body .clause-id {
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--c-amber);
          letter-spacing: 0.04em;
          margin-right: 6px;
        }
        .legal-body table {
          width: 100%;
          border-collapse: collapse;
          margin: 12px 0 20px;
          font-size: 13px;
        }
        .legal-body th, .legal-body td {
          border: 1px solid var(--c-border);
          padding: 10px 12px;
          text-align: left;
          vertical-align: top;
        }
        .legal-body th {
          background: var(--c-surface);
          color: var(--c-text);
          font-weight: 600;
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
      `}</style>
    </>
  )
}
