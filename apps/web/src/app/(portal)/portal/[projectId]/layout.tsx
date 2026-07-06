import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePortalAccess, getPortalProject } from '@/lib/portal/data'
import { PortalProjectNav } from '@/components/portal/PortalProjectNav'

/**
 * Per-project portal frame. The access gate runs HERE so every aspect page
 * under /portal/[projectId]/* is membership-checked before it renders —
 * no page below can forget it.
 */
export default async function PortalProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params

  const access = await requirePortalAccess(projectId)
  if (!access) notFound()

  const project = await getPortalProject(projectId)
  if (!project) notFound()

  return (
    <div>
      <Link href="/portal" style={{ fontSize: 12, color: 'var(--c-text-dim)', textDecoration: 'none' }}>
        ← Your sites
      </Link>
      <div style={{ margin: '10px 0 4px', display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--c-text)' }}>{project.name}</h1>
        <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
          {[project.address, project.province].filter(Boolean).join(', ')}
        </span>
      </div>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--c-text-dim)' }}>
        View-only access — contact your project team to request changes.
      </p>
      <PortalProjectNav projectId={projectId} />
      {children}
    </div>
  )
}
