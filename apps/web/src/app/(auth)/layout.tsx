import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'E-Site — Construction Management',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      {/* Structural grid background */}
      <div className="auth-grid" aria-hidden />

      {/* Left brand panel — hidden on mobile */}
      <aside className="auth-brand">
        <div className="auth-brand-inner">
          <div className="auth-logo">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="8" fill="#F59E0B" />
              <path d="M8 32V16l12-8 12 8v16" stroke="#1C1917" strokeWidth="2.5" strokeLinejoin="round" />
              <rect x="15" y="22" width="10" height="10" fill="#1C1917" />
            </svg>
            <span className="auth-logo-text">E-Site</span>
          </div>

          <div className="auth-tagline">
            <h1>Built for South African construction.</h1>
            <p>Compliance, projects, field operations — managed from one platform.</p>
          </div>

          <ul className="auth-features">
            {[
              { icon: '⬡', label: 'COC compliance tracking' },
              { icon: '◈', label: 'Site diary & snag lists' },
              { icon: '◎', label: 'Supplier marketplace' },
              { icon: '◇', label: 'POPIA-compliant data' },
            ].map(f => (
              <li key={f.label}>
                <span className="feat-icon">{f.icon}</span>
                {f.label}
              </li>
            ))}
          </ul>

          <p className="auth-legal">© 2026 E-Site. Watson Mattheus Engineering.</p>
        </div>
      </aside>

      {/* Right form panel */}
      <main className="auth-form-panel">
        <div className="auth-form-inner">
          {/* Mobile logo */}
          <div className="auth-mobile-logo">
            <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="8" fill="#F59E0B" />
              <path d="M8 32V16l12-8 12 8v16" stroke="#1C1917" strokeWidth="2.5" strokeLinejoin="round" />
              <rect x="15" y="22" width="10" height="10" fill="#1C1917" />
            </svg>
            <span>E-Site</span>
          </div>
          {children}
        </div>
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Instrument+Sans:wght@400;500;600;700&display=swap');

        * { box-sizing: border-box; }

        .auth-shell {
          min-height: 100vh;
          display: grid;
          grid-template-columns: 1fr;
          background: #0C0A09;
          font-family: 'Instrument Sans', sans-serif;
          position: relative;
          overflow: hidden;
        }
        @media (min-width: 1024px) {
          .auth-shell { grid-template-columns: 460px 1fr; }
        }

        .auth-grid {
          position: fixed;
          inset: 0;
          background-image:
            linear-gradient(rgba(245,158,11,0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(245,158,11,0.035) 1px, transparent 1px);
          background-size: 48px 48px;
          pointer-events: none;
          z-index: 0;
        }

        .auth-brand {
          display: none;
          position: sticky;
          top: 0;
          height: 100vh;
          z-index: 1;
          background: #111110;
          border-right: 1px solid #1C1917;
        }
        @media (min-width: 1024px) {
          .auth-brand { display: flex; flex-direction: column; }
        }

        .auth-brand-inner {
          display: flex;
          flex-direction: column;
          height: 100%;
          padding: 48px 44px;
          gap: 40px;
        }

        .auth-logo {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .auth-logo-text {
          font-size: 22px;
          font-weight: 700;
          color: #FAFAF9;
          letter-spacing: -0.04em;
        }

        .auth-tagline { margin-top: auto; }
        .auth-tagline h1 {
          font-size: 30px;
          font-weight: 700;
          color: #FAFAF9;
          line-height: 1.2;
          letter-spacing: -0.04em;
          margin: 0 0 14px;
        }
        .auth-tagline p {
          font-size: 14px;
          color: #78716C;
          line-height: 1.65;
          margin: 0;
        }

        .auth-features {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .auth-features li {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 13px;
          color: #A8A29E;
          font-weight: 500;
        }
        .feat-icon {
          color: #F59E0B;
          font-size: 15px;
          width: 20px;
          text-align: center;
          flex-shrink: 0;
        }

        .auth-legal {
          font-size: 11px;
          color: #3C3735;
          margin: 0;
          font-family: 'DM Mono', monospace;
        }

        /* ── Form panel ── */
        .auth-form-panel {
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          z-index: 1;
          padding: 40px 20px;
          min-height: 100vh;
        }
        .auth-form-inner {
          width: 100%;
          max-width: 400px;
        }

        .auth-mobile-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 40px;
          font-size: 18px;
          font-weight: 700;
          color: #FAFAF9;
          letter-spacing: -0.04em;
        }
        @media (min-width: 1024px) { .auth-mobile-logo { display: none; } }

        /* ── Card ── */
        .auth-card {
          background: #111110;
          border: 1px solid #1C1917;
          border-radius: 14px;
          padding: 32px;
        }
        .auth-card-title {
          font-size: 22px;
          font-weight: 700;
          color: #FAFAF9;
          letter-spacing: -0.04em;
          margin: 0 0 4px;
        }
        .auth-card-sub {
          font-size: 13px;
          color: #78716C;
          margin: 0 0 28px;
        }

        /* ── Fields ── */
        .auth-field { margin-bottom: 14px; }
        .auth-label {
          display: block;
          font-size: 11px;
          font-weight: 500;
          color: #78716C;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 6px;
          font-family: 'DM Mono', monospace;
        }
        .auth-input {
          width: 100%;
          background: #0C0A09;
          border: 1px solid #292524;
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 14px;
          color: #FAFAF9;
          font-family: 'Instrument Sans', sans-serif;
          transition: border-color 0.15s, box-shadow 0.15s;
          outline: none;
        }
        .auth-input::placeholder { color: #44403C; }
        .auth-input:focus {
          border-color: #F59E0B;
          box-shadow: 0 0 0 3px rgba(245,158,11,0.1);
        }
        .auth-input-error { border-color: #7F1D1D !important; }
        .auth-error-text { font-size: 12px; color: #F87171; margin: 4px 0 0; }

        .auth-select {
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='7' fill='none'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2357534E' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 14px center;
          padding-right: 36px;
          cursor: pointer;
        }
        .auth-select option { background: #1C1917; }

        /* ── Button ── */
        .auth-btn {
          width: 100%;
          background: #F59E0B;
          color: #1C1917;
          font-size: 14px;
          font-weight: 700;
          font-family: 'Instrument Sans', sans-serif;
          border: none;
          border-radius: 8px;
          padding: 11px 20px;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
          letter-spacing: -0.01em;
          margin-top: 6px;
        }
        .auth-btn:hover:not(:disabled) { background: #FBBF24; }
        .auth-btn:active:not(:disabled) { transform: scale(0.99); }
        .auth-btn:disabled { opacity: 0.45; cursor: not-allowed; }

        /* ── Alert ── */
        .auth-alert-error {
          background: rgba(127,29,29,0.25);
          border: 1px solid rgba(185,28,28,0.4);
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 13px;
          color: #FCA5A5;
          margin-bottom: 16px;
        }

        /* ── Links ── */
        .auth-links {
          margin-top: 22px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          text-align: center;
        }
        .auth-link {
          font-size: 13px;
          color: #57534E;
          text-decoration: none;
          transition: color 0.15s;
        }
        .auth-link:hover { color: #F59E0B; }
        .auth-link-accent { color: #F59E0B; font-weight: 600; }

        /* ── Checkbox ── */
        .auth-checkbox-row {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 14px;
        }
        .auth-checkbox {
          margin-top: 2px;
          width: 15px;
          height: 15px;
          flex-shrink: 0;
          accent-color: #F59E0B;
          cursor: pointer;
        }
        .auth-checkbox-label {
          font-size: 12px;
          color: #57534E;
          line-height: 1.6;
          cursor: pointer;
        }

        /* ── Success state ── */
        .auth-success {
          text-align: center;
          padding: 16px 0;
        }
        .auth-success-icon {
          font-size: 40px;
          margin-bottom: 16px;
        }
        .auth-success h2 {
          font-size: 20px;
          font-weight: 700;
          color: #FAFAF9;
          letter-spacing: -0.03em;
          margin: 0 0 8px;
        }
        .auth-success p {
          font-size: 13px;
          color: #78716C;
          margin: 0;
          line-height: 1.6;
        }
      `}</style>
    </div>
  )
}
