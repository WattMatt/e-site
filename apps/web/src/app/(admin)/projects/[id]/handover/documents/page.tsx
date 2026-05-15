import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  ALL_CATEGORIES,
  CATEGORY_LABELS,
  type HandoverCategory,
} from '@esite/shared'
import { HandoverInitButton } from './HandoverInitButton'
import { HandoverNewFolderForm } from './HandoverNewFolderForm'
import { HandoverUploadForm } from './HandoverUploadForm'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ category?: string; folder?: string }>
}

interface HandoverFolder {
  id: string
  parent_folder_id: string | null
  name: string
  folder_path: string
  cloud_folder_id: string | null
  cloud_provider: string | null
}

interface HandoverDoc {
  id: string
  name: string
  storage_path: string
  size_bytes: number | null
  cloud_mirror_provider: string | null
  cloud_mirror_synced_at: string | null
  created_at: string
}

export default async function HandoverDocumentsPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const sp = await searchParams
  const category = (ALL_CATEGORIES as readonly string[]).includes(sp.category ?? '')
    ? (sp.category as HandoverCategory)
    : 'generators'

  const supabase = await createClient()

  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select(
      'id, name, cloud_storage_connection_id, cloud_storage_folder_path, handover_cloud_folder_path',
    )
    .eq('id', projectId)
    .maybeSingle()
  if (!project) notFound()

  const { data: folderRows } = await (supabase as any)
    .schema('tenants')
    .from('handover_folders')
    .select('id, parent_folder_id, name, folder_path, cloud_folder_id, cloud_provider')
    .eq('project_id', projectId)
    .eq('category', category)
    .order('folder_path', { ascending: true })

  const folders = (folderRows ?? []) as HandoverFolder[]
  const rootFolder = folders.find((f) => f.parent_folder_id === null) ?? null
  const activeFolder = folders.find((f) => f.id === sp.folder) ?? rootFolder

  let documents: HandoverDoc[] = []
  if (activeFolder) {
    const { data: docRows } = await (supabase as any)
      .schema('tenants')
      .from('documents')
      .select(
        'id, name, storage_path, size_bytes, cloud_mirror_provider, cloud_mirror_synced_at, created_at',
      )
      .eq('handover_folder_id', activeFolder.id)
      .order('created_at', { ascending: false })
    documents = (docRows ?? []) as HandoverDoc[]
  }

  const cloudConnected = !!project.cloud_storage_connection_id

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/handover`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← Handover checklist
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{project.name} — Documents</h1>
          <p className="page-subtitle">
            {cloudConnected
              ? `Cloud mirror: ${project.handover_cloud_folder_path ?? project.cloud_storage_folder_path ?? 'connected'}`
              : 'No cloud-storage mapping — files stay in E-Site only.'}
          </p>
        </div>
      </div>

      {/* Category tabs */}
      <div
        className="animate-fadeup animate-fadeup-1"
        style={{
          display: 'flex',
          gap: 4,
          flexWrap: 'wrap',
          padding: '8px 0',
          marginBottom: 16,
          borderBottom: '1px solid var(--c-border)',
        }}
      >
        {ALL_CATEGORIES.map((c) => (
          <Link
            key={c}
            href={`/projects/${projectId}/handover/documents?category=${c}`}
            className={c === category ? 'btn-primary-amber' : ''}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              borderRadius: 4,
              color: c === category ? undefined : 'var(--c-text-dim)',
              textDecoration: 'none',
              border: c === category ? undefined : '1px solid var(--c-border)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
            }}
          >
            {CATEGORY_LABELS[c]}
          </Link>
        ))}
      </div>

      {folders.length === 0 ? (
        <div className="data-panel" style={{ padding: 24, textAlign: 'center' }}>
          <p style={{ marginBottom: 12, color: 'var(--c-text-dim)' }}>
            No <strong>{CATEGORY_LABELS[category]}</strong> folders yet. Initialize from
            the SANS-aligned template to create the standard tree
            {cloudConnected ? ' (and mirror it into your cloud).' : '.'}
          </p>
          <HandoverInitButton projectId={projectId} category={category} />
        </div>
      ) : (
        <div
          className="animate-fadeup animate-fadeup-2"
          style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}
        >
          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">Folders</span>
            </div>
            <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {renderFolderTree(folders, null, 0, projectId, category, activeFolder?.id)}
            </div>
          </div>

          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">
                {activeFolder?.folder_path ?? '/'}
              </span>
              {activeFolder?.cloud_folder_id && (
                <span className="badge badge-blue">{activeFolder.cloud_provider ?? 'cloud'} ↔</span>
              )}
            </div>

            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {activeFolder && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <HandoverUploadForm projectId={projectId} folderId={activeFolder.id} />
                  <HandoverNewFolderForm projectId={projectId} parentFolderId={activeFolder.id} />
                </div>
              )}

              {documents.length === 0 ? (
                <div className="data-panel-empty" style={{ padding: '12px 0' }}>
                  No documents in this folder yet.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--c-text-dim)', fontSize: 11 }}>
                      <th style={{ padding: '6px 8px' }}>Name</th>
                      <th style={{ padding: '6px 8px' }}>Size</th>
                      <th style={{ padding: '6px 8px' }}>Cloud</th>
                      <th style={{ padding: '6px 8px' }}>Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((d) => (
                      <tr key={d.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                        <td style={{ padding: '8px' }}>{d.name}</td>
                        <td style={{ padding: '8px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          {formatBytes(d.size_bytes ?? 0)}
                        </td>
                        <td style={{ padding: '8px' }}>
                          {d.cloud_mirror_provider ? (
                            <span className="badge badge-green">{d.cloud_mirror_provider}</span>
                          ) : (
                            <span className="badge badge-muted">local only</span>
                          )}
                        </td>
                        <td
                          style={{
                            padding: '8px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            color: 'var(--c-text-dim)',
                          }}
                        >
                          {new Date(d.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function renderFolderTree(
  all: HandoverFolder[],
  parentId: string | null,
  depth: number,
  projectId: string,
  category: HandoverCategory,
  activeId: string | undefined,
): React.ReactNode {
  const children = all.filter((f) => f.parent_folder_id === parentId)
  if (children.length === 0) return null
  return children.map((f) => (
    <div key={f.id}>
      <Link
        href={`/projects/${projectId}/handover/documents?category=${category}&folder=${f.id}`}
        style={{
          display: 'block',
          padding: `4px 6px 4px ${8 + depth * 12}px`,
          fontSize: 13,
          color: f.id === activeId ? 'var(--c-amber)' : 'var(--c-text)',
          textDecoration: 'none',
          borderRadius: 3,
          background: f.id === activeId ? 'rgba(255,170,0,0.1)' : 'transparent',
        }}
      >
        {depth === 0 ? '📂' : '📁'} {f.name}
        {f.cloud_folder_id && (
          <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--c-text-dim)' }}>↔</span>
        )}
      </Link>
      {renderFolderTree(all, f.id, depth + 1, projectId, category, activeId)}
    </div>
  ))
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
