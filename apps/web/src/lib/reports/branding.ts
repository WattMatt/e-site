import { resolveAccent } from './theme'

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface BrandingInput {
  org: {
    name: string
    logoSrc?: string | null
    accent?: string | null
  }
  project: {
    name: string
    clientLogoSrc?: string | null
    projectMarkSrc?: string | null
    accent?: string | null
    subtitle?: string
  }
  contractor?: { name: string; logoSrc?: string | null } | null
  title: string
  kicker: string
  date: string
}

export interface ResolvedBranding {
  accent: string
  /** Either a logo image src or a text wordmark — never both. */
  issuer: { logoSrc?: string; wordmark?: string }
  /** Parties with confirmed logo srcs only (missing slots are omitted). */
  parties: Array<{ label: string; logoSrc: string }>
  title: string
  kicker: string
  /** e.g. "Kingswalk Mall — Phase 2 · 2026-06-03" */
  projectLine: string
  /** Footer generated/version stamp. */
  footerStamp: string
}

// ---------------------------------------------------------------------------
// Resolver (pure — no I/O, no async, no Supabase)
// ---------------------------------------------------------------------------

/**
 * Takes already-resolved logo `src` strings (URLs or data URIs) and returns
 * the normalised branding shape with all fallbacks / precedence applied.
 */
export function resolveBranding(input: BrandingInput): ResolvedBranding {
  const { org, project, contractor, title, kicker, date } = input

  // Accent: project wins → org fallback → default
  const accent = resolveAccent(project.accent, org.accent)

  // Issuer: logo when present, otherwise org name as wordmark
  const issuer: ResolvedBranding['issuer'] = org.logoSrc
    ? { logoSrc: org.logoSrc }
    : { wordmark: org.name }

  // Parties strip: only include slots with a real src
  const parties: ResolvedBranding['parties'] = []
  if (project.clientLogoSrc) {
    parties.push({ label: 'Prepared for', logoSrc: project.clientLogoSrc })
  }
  if (project.projectMarkSrc) {
    parties.push({ label: 'Project', logoSrc: project.projectMarkSrc })
  }
  if (contractor?.logoSrc) {
    parties.push({ label: 'Contractor', logoSrc: contractor.logoSrc })
  }

  // Project line: "Name — Subtitle · date" or just "Name"
  const projectLine = project.subtitle
    ? `${project.name} — ${project.subtitle}`
    : project.name

  const footerStamp = `Generated ${date} · e-site.live`

  return { accent, issuer, parties, title, kicker, projectLine, footerStamp }
}
