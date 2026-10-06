// apps/web/src/app/(admin)/settings/users/MemberSites.tsx
// Which sites a person can see (site-scoped access, spec 2026-10-01):
// org owner/admin see every site; everyone else only their project memberships.
import Link from 'next/link'

export interface MemberSite {
  projectId: string
  name: string
  role: string
}

const ALL_SITES_ROLES = ['owner', 'admin']

const dim: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }

export function MemberSites({ orgRole, sites }: { orgRole: string; sites: MemberSite[] }) {
  if (ALL_SITES_ROLES.includes(orgRole)) {
    return <p style={dim}>All sites</p>
  }
  if (sites.length === 0) {
    return (
      <p style={dim}>
        No sites —{' '}
        <Link href="/projects" style={{ color: 'var(--c-amber)' }}>add them to a project</Link>
      </p>
    )
  }
  return (
    <p style={{ ...dim, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {sites.map((s) => (
        <Link
          key={s.projectId}
          href={`/projects/${s.projectId}/settings/members`}
          style={{ color: 'var(--c-amber)', textDecoration: 'none' }}
          title={`${s.role.replace(/_/g, ' ')} on this site`}
        >
          {s.name}
        </Link>
      ))}
    </p>
  )
}
