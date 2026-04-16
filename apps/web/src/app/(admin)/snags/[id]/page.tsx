import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { snagService, formatDate, formatRelative } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { Card, CardBody } from '@/components/ui/Card'
import { snagStatusBadge, priorityBadge } from '@/components/ui/Badge'
import { SnagStatusForm } from './SnagStatusForm'
import { SnagPhotoGrid } from './SnagPhotoGrid'

interface Props { params: Promise<{ id: string }> }

export default async function SnagDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const snag = await snagService.getById(supabase as any, id).catch(() => null)
  if (!snag) notFound()

  const project = snag.project as any
  const raisedBy = (snag as any).raised_by_profile as any
  const assignedTo = (snag as any).assigned_to_profile as any
  const signedOffBy = (snag as any).signed_off_by_profile as any
  const photos = (snag as any).snag_photos as any[] ?? []

  // Build signed URLs for photos
  const photoUrls = await Promise.all(
    photos.map(async (p: any) => {
      const { data } = await supabase.storage.from('snag-photos').createSignedUrl(p.file_path, 3600)
      return { ...p, url: data?.signedUrl }
    })
  )

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-slate-400">
        <Link href="/snags" className="hover:text-white">Snags</Link>
        <span>/</span>
        <Link href={`/projects/${project?.id}`} className="hover:text-white">{project?.name}</Link>
      </div>

      <PageHeader
        title={snag.title}
        subtitle={snag.location ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            {priorityBadge(snag.priority)}
            {snagStatusBadge(snag.status)}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-4">
          {snag.description && (
            <Card>
              <CardBody>
                <h3 className="text-sm font-medium text-slate-400 mb-2">Description</h3>
                <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">{snag.description}</p>
              </CardBody>
            </Card>
          )}

          {/* Photos */}
          {photoUrls.length > 0 && (
            <Card>
              <CardBody>
                <h3 className="text-sm font-medium text-slate-400 mb-3">Evidence Photos ({photoUrls.length})</h3>
                <SnagPhotoGrid photos={photoUrls} />
              </CardBody>
            </Card>
          )}

          {/* Status update */}
          <Card>
            <CardBody>
              <h3 className="text-sm font-medium text-slate-400 mb-3">Update Status</h3>
              <SnagStatusForm snagId={id} currentStatus={snag.status} projectId={project?.id ?? ''} />
            </CardBody>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardBody className="space-y-4">
              <h3 className="text-sm font-medium text-slate-400">Details</h3>
              {[
                ['Category', snag.category],
                ['Location', snag.location],
                ['Project', project?.name],
                ['Raised by', raisedBy?.full_name],
                ['Raised', formatRelative(snag.created_at)],
                ['Assigned to', assignedTo?.full_name ?? 'Unassigned'],
              ].map(([label, value]) => value ? (
                <div key={label as string}>
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="text-sm text-white mt-0.5">{value}</p>
                </div>
              ) : null)}

              {snag.signed_off_at && (
                <div className="pt-3 border-t border-slate-700">
                  <p className="text-xs text-slate-500">Signed off by</p>
                  <p className="text-sm text-emerald-400 mt-0.5">{signedOffBy?.full_name}</p>
                  <p className="text-xs text-slate-500">{formatDate(snag.signed_off_at)}</p>
                </div>
              )}
            </CardBody>
          </Card>

          <Link href={`/projects/${project?.id}/snags/new`}>
            <button className="w-full text-center text-sm text-blue-400 hover:text-blue-300 py-3 bg-slate-800 border border-slate-700 rounded-xl transition-colors">
              + Raise another snag
            </button>
          </Link>
        </div>
      </div>
    </div>
  )
}
