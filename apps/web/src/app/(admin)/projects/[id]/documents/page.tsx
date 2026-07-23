import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, ORG_WRITE_ROLES } from '@esite/shared'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { CloudSyncToolbar } from '@/components/cloud-storage/CloudSyncToolbar'
import { DocumentList, type DocumentListItem } from './DocumentList'

interface Props {
  params: Promise<{ id: string }>
}

interface ConnectionOption {
  id: string
  provider: 'dropbox' | 'google_drive' | 'onedrive'
  account_email: string
  needs_reauth: boolean | null
}

interface DocumentRow {
  id: string
  name: string
  category: string | null
  storage_path: string
  mime_type: string | null
  size_bytes: number | null
  source_provider: string | null
  source_path: string | null
  synced_at: string | null
  created_at: string
}

export default async function DocumentsPage({ params }: Props) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  // Documents (tenants schema). Casts through `any` because the new
  // tables aren't yet in packages/db/src/types.ts — regen will land in a
  // future polish commit; doing it here would cascade type errors into
  // unrelated upstream code.
  const { data: docs } = await (supabase as any)
    .schema('tenants')
    .from('documents')
    .select(
      'id, name, category, storage_path, mime_type, size_bytes, source_provider, source_path, synced_at, created_at',
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  // Connections in this org (for the picker)
  const { data: connections } = await (supabase as any)
    .from('org_storage_connections')
    .select('id, provider, account_email, needs_reauth')
    .order('created_at', { ascending: false })

  // Write affordances (Sync now / Set folder / Clear) are gated on the
  // effective project role; read-only members still get the toolbar with
  // the auto-check freshness chip. Server actions + RLS enforce the same
  // boundary — this just stops offering actions the caller can't complete.
  const gate = await requireEffectiveRole(supabase as any, projectId, ORG_WRITE_ROLES)
  const canWrite = gate.ok

  const documents = ((docs ?? []) as unknown as DocumentRow[]).map<DocumentListItem>((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    sizeBytes: d.size_bytes,
    mimeType: d.mime_type,
    storagePath: d.storage_path,
    sourceProvider: d.source_provider as DocumentListItem['sourceProvider'],
    sourcePath: d.source_path,
    syncedAt: d.synced_at,
    createdAt: d.created_at,
  }))

  const cloudFolderPath = (project as unknown as { cloud_storage_folder_path?: string | null })
    .cloud_storage_folder_path ?? null
  const lastSyncAt = (project as unknown as { cloud_storage_last_sync_at?: string | null })
    .cloud_storage_last_sync_at ?? null
  const mappedConnectionId = (project as unknown as { cloud_storage_connection_id?: string | null })
    .cloud_storage_connection_id ?? null

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Documents</h1>
          <p className="page-subtitle">
            {project.name} · {documents.length} document{documents.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <CloudSyncToolbar
        projectId={projectId}
        connections={(connections ?? []) as unknown as ConnectionOption[]}
        mappedConnectionId={mappedConnectionId}
        cloudFolderPath={cloudFolderPath}
        lastSyncAt={lastSyncAt}
        intent="documents"
        canWrite={canWrite}
      />

      <DocumentList documents={documents} />
    </div>
  )
}
