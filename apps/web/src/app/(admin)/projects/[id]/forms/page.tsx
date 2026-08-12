import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { projectService, formatDate, asLeftStatusLabel } from '@esite/shared'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ status?: string; board?: string }>
}

interface FormRow {
  id: string
  form_no: string | null
  node_id: string | null
  board_ref: string | null
  board_label: string | null
  status: string
  as_left_status: string | null
  created_at: string
  submitted_at: string | null
  distributed_at: string | null
  created_by: string | null
  template_row_id: string
}

const statusBadge = (s: string) =>
  ({
    draft: 'badge badge-muted',
    submitted: 'badge badge-blue',
    distributed: 'badge badge-green',
    void: 'badge badge-red',
  })[s] ?? 'badge badge-muted'

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'submitted', label: 'Awaiting distribution' },
  { key: 'distributed', label: 'Distributed' },
  { key: 'void', label: 'Void' },
] as const

/** The board this record describes, however it was identified. */
function boardOf(f: FormRow): string {
  return f.board_label ?? f.board_ref ?? 'Board not identified'
}

export default async function ProjectFormsPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { status, board } = await searchParams

  const supabase = await createClient()
  const project = await projectService.getById(supabase as never, projectId)
  if (!project) notFound()

  // RLS is the gate: the site_forms SELECT policy shows client_viewer only
  // distributed records, and everyone else every record on their projects.
  const { data } = await (supabase as never as {
    schema: (s: string) => {
      from: (t: string) => {
        select: (c: string) => {
          eq: (a: string, b: string) => { order: (c: string, o: object) => Promise<{ data: FormRow[] | null }> }
        }
      }
    }
  })
    .schema('field')
    .from('site_forms')
    .select(
      'id, form_no, node_id, board_ref, board_label, status, as_left_status, created_at, submitted_at, distributed_at, created_by, template_row_id',
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  const all = (data ?? []) as FormRow[]

  // Names come from the service client: public.profiles RLS returns only the
  // caller's own row, so a cookie-client lookup would leave every name blank.
  const creatorIds = [...new Set(all.map((f) => f.created_by).filter(Boolean))] as string[]
  const names = new Map<string, string>()
  if (creatorIds.length > 0) {
    const service = createServiceClient()
    const { data: profiles } = await service
      .from('profiles')
      .select('id, full_name')
      .in('id', creatorIds)
    for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) {
      if (p.full_name) names.set(p.id, p.full_name)
    }
  }

  const activeStatus = status && status !== 'all' ? status : null
  const forms = all.filter(
    (f) => (!activeStatus || f.status === activeStatus) && (!board || boardOf(f) === board),
  )

  const boards = [...new Set(all.map(boardOf))].sort()

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Forms</h1>
          <p className="page-subtitle">
            Site records captured per board. {project.name}
          </p>
        </div>
        <Link href={`/projects/${projectId}/forms/new`} className="btn btn-primary">
          + New form
        </Link>
      </div>

      {all.length === 0 ? (
        // The empty state carries the call to action deliberately. A feature
        // reachable only by deep link is not reachable: PR #159 shipped a photo
        // uploader nobody could get to because the default view had no CTA.
        <div className="card empty-state">
          <h2>No forms captured yet</h2>
          <p>
            Create a Termination and Making Safe record for each existing distribution board as
            it is isolated and made safe. Each record stays on the project permanently and can be
            distributed to the whole project team as a branded PDF.
          </p>
          <Link href={`/projects/${projectId}/forms/new`} className="btn btn-primary">
            Create the first form
          </Link>
        </div>
      ) : (
        <>
          <div className="filter-bar">
            {STATUS_FILTERS.map((f) => {
              const isActive = (status ?? 'all') === f.key
              const count =
                f.key === 'all' ? all.length : all.filter((x) => x.status === f.key).length
              return (
                <Link
                  key={f.key}
                  href={`/projects/${projectId}/forms${f.key === 'all' ? '' : `?status=${f.key}`}`}
                  className={isActive ? 'chip chip-active' : 'chip'}
                >
                  {f.label} ({count})
                </Link>
              )
            })}
          </div>

          {boards.length > 1 && (
            <div className="filter-bar">
              <Link
                href={`/projects/${projectId}/forms${activeStatus ? `?status=${activeStatus}` : ''}`}
                className={!board ? 'chip chip-active' : 'chip'}
              >
                All boards
              </Link>
              {boards.map((b) => (
                <Link
                  key={b}
                  href={`/projects/${projectId}/forms?board=${encodeURIComponent(b)}${activeStatus ? `&status=${activeStatus}` : ''}`}
                  className={board === b ? 'chip chip-active' : 'chip'}
                >
                  {b}
                </Link>
              ))}
            </div>
          )}

          {forms.length === 0 ? (
            <div className="card empty-state">
              <p>No forms match this filter.</p>
            </div>
          ) : (
            <div className="card">
              <table className="table">
                <thead>
                  <tr>
                    <th>Form no.</th>
                    <th>Board</th>
                    <th>Status</th>
                    <th>As left</th>
                    <th>Captured by</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {forms.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <Link href={`/projects/${projectId}/forms/${f.id}`}>
                          {f.form_no ?? 'Unnumbered'}
                        </Link>
                      </td>
                      <td>{boardOf(f)}</td>
                      <td>
                        <span className={statusBadge(f.status)}>{f.status}</span>
                      </td>
                      <td>{f.as_left_status ? asLeftStatusLabel(f.as_left_status) : '—'}</td>
                      <td>{f.created_by ? (names.get(f.created_by) ?? '—') : '—'}</td>
                      <td>{formatDate(f.distributed_at ?? f.submitted_at ?? f.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
