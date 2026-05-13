import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, floorPlanService } from '@esite/shared'
import { FloorPlanUploadButton } from './FloorPlanUploadButton'
import { DrawingsList, type DrawingListItem } from './DrawingsList'
import { CloudSyncToolbar } from '@/components/cloud-storage/CloudSyncToolbar'

interface Props { params: Promise<{ id: string }> }

interface ConnectionOption {
  id: string
  provider: 'dropbox' | 'google_drive' | 'onedrive'
  account_email: string
}

export default async function FloorPlansPage({ params }: Props) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const [project, plans, connectionsRes] = await Promise.all([
    projectService.getById(supabase as any, projectId).catch(() => null),
    floorPlanService.listByProject(supabase as any, projectId).catch(() => []),
    // Connections (for the picker). Cast through any: tables not in types.ts yet.
    (supabase as any)
      .from('org_storage_connections')
      .select('id, provider, account_email')
      .order('created_at', { ascending: false }),
  ])
  if (!project) notFound()

  const orgId = (project as any).organisation_id as string
  const connections = (connectionsRes?.data ?? []) as unknown as ConnectionOption[]
  const cloudFolderPath = (project as any).cloud_storage_folder_path ?? null
  const lastSyncAt = (project as any).cloud_storage_last_sync_at ?? null
  const mappedConnectionId = (project as any).cloud_storage_connection_id ?? null

  // Drawings list is row-based — no per-row image preview, so we don't pay
  // the cost of a signed-URL round-trip per drawing.
  const plansWithUrls: DrawingListItem[] = plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    level: plan.level,
    scale: plan.scale,
    file_size_bytes: plan.file_size_bytes,
    previewUrl: null,
    source_path: (plan as { source_path?: string | null }).source_path ?? null,
    file_path: plan.file_path,
  }))

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Floor Plans</h1>
          <p className="page-subtitle">{project.name} · {plansWithUrls.length} plan{plansWithUrls.length !== 1 ? 's' : ''}</p>
        </div>
        <FloorPlanUploadButton projectId={projectId} orgId={orgId} />
      </div>

      <CloudSyncToolbar
        projectId={projectId}
        connections={connections}
        mappedConnectionId={mappedConnectionId}
        cloudFolderPath={cloudFolderPath}
        lastSyncAt={lastSyncAt}
        intent="drawings"
      />

      <DrawingsList plans={plansWithUrls} projectId={projectId} />
    </div>
  )
}
