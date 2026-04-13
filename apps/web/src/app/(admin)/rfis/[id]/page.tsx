import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { rfiService, formatDate, formatRelative } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { priorityBadge } from '@/components/ui/Badge'
import { RfiRespondForm } from './RfiRespondForm'
import { RfiCloseButton } from './RfiCloseButton'

interface Props { params: Promise<{ id: string }> }

const STATUS_VARIANT: Record<string, any> = { draft: 'ghost', open: 'danger', responded: 'warning', closed: 'success' }

export default async function RfiDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const rfi = await rfiService.getById(supabase as any, id).catch(() => null)
  if (!rfi) notFound()

  const raisedBy = (rfi as any).raised_by_profile as any
  const assignedTo = (rfi as any).assigned_to_profile as any
  const responses = (rfi as any).rfi_responses as any[] ?? []

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link href="/rfis" className="text-slate-400 hover:text-white text-sm">← RFIs</Link>
      </div>

      <PageHeader
        title={rfi.subject}
        actions={
          <div className="flex items-center gap-2">
            {priorityBadge(rfi.priority)}
            <Badge variant={STATUS_VARIANT[rfi.status]}>{rfi.status}</Badge>
          </div>
        }
      />

      <div className="space-y-4">
        {/* Description */}
        <Card>
          <CardBody>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-600/30 flex items-center justify-center text-sm font-bold text-blue-400">
                  {raisedBy?.full_name?.[0] ?? '?'}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{raisedBy?.full_name}</p>
                  <p className="text-xs text-slate-400">{formatRelative(rfi.created_at)}</p>
                </div>
              </div>
              {rfi.due_date && <p className="text-xs text-slate-400">Due {formatDate(rfi.due_date)}</p>}
            </div>
            <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{rfi.description}</p>
            {rfi.category && <p className="text-xs text-slate-500 mt-3">Category: {rfi.category}</p>}
          </CardBody>
        </Card>

        {/* Responses */}
        {responses.map((r: any) => (
          <Card key={r.id} className="border-l-4 border-l-blue-600 ml-4">
            <CardBody>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full bg-emerald-600/30 flex items-center justify-center text-sm font-bold text-emerald-400">
                  {r.responder?.full_name?.[0] ?? '?'}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{r.responder?.full_name}</p>
                  <p className="text-xs text-slate-400">{formatRelative(r.created_at)}</p>
                </div>
              </div>
              <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{r.body}</p>
            </CardBody>
          </Card>
        ))}

        {/* Respond / Close */}
        {rfi.status !== 'closed' && (
          <Card>
            <CardBody>
              <h3 className="text-sm font-medium text-slate-400 mb-3">
                {responses.length === 0 ? 'Respond to RFI' : 'Add follow-up'}
              </h3>
              <RfiRespondForm rfiId={id} />
            </CardBody>
          </Card>
        )}

        {rfi.status !== 'closed' && (
          <div className="flex justify-end">
            <RfiCloseButton rfiId={id} />
          </div>
        )}

        {/* Meta sidebar info */}
        <div className="flex gap-6 text-xs text-slate-500 pt-2">
          {assignedTo && <span>Assigned to <span className="text-slate-300">{assignedTo.full_name}</span></span>}
          <span>Raised <span className="text-slate-300">{formatDate(rfi.created_at)}</span></span>
          {rfi.closed_at && <span>Closed <span className="text-slate-300">{formatDate(rfi.closed_at)}</span></span>}
        </div>
      </div>
    </div>
  )
}
