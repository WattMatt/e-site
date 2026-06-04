import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  projectService,
  snagVisitService,
  computeVisitBuckets,
  formatDate,
} from '@esite/shared'
import { VisitDetail } from './VisitDetail'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ id: string; visitId: string }>
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function VisitDetailPage({ params }: Props) {
  const { id: projectId, visitId } = await params

  const supabase = await createClient()

  // Access gate: resolve project (same pattern as ProjectSnagsPage).
  // Any active org member can view (write-role check lives in the actions).
  const project = await projectService.getById(supabase as any, projectId).catch(() => null)
  if (!project) notFound()

  // Resolve the current user — needed for VisitForm default + member list.
  // Must be above any conditional returns (hooks-order lesson).
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const currentUserId = user?.id ?? ''

  // ── Service client for reads that require seeing other users' profiles ──
  // public.profiles RLS only returns the viewer's own row to the cookie client.
  const serviceClient = createServiceClient() as any

  // ── Fetch the target visit ──
  const visit = await snagVisitService.getVisit(serviceClient as never, visitId).catch(() => null)
  if (!visit || (visit as any).project_id !== projectId) notFound()

  // ── Fetch all visits + all snags (with photos) for this project ──
  const [allVisitsRaw, allSnags] = await Promise.all([
    snagVisitService.listVisits(serviceClient as never, projectId).catch(() => []),
    snagVisitService.listVisitSnags(serviceClient as never, projectId).catch(() => []),
  ])

  // listVisits returns visit rows augmented with newCount/openCount/closedCount.
  // computeVisitBuckets needs bare BucketVisit shape — that's fine, the extra
  // fields are transparently passed through by the generic.
  const allVisits = allVisitsRaw as Array<{ id: string; visit_no: number; [k: string]: unknown }>

  // ── Compute the three buckets ──
  const buckets = computeVisitBuckets(
    visit as { id: string; visit_no: number },
    allVisits,
    allSnags as any[],
  )

  // ── Resolve photo signed URLs for all snags in the buckets ──
  // We only need thumbnails here; 1-hour TTL matches the existing snag detail.
  const allBucketSnags = [
    ...buckets.newSnags,
    ...buckets.stillOpen,
    ...buckets.closedThisVisit,
  ] as any[]

  const photoUrlMap = new Map<string, string | undefined>()
  await Promise.all(
    allBucketSnags.flatMap((s: any) =>
      (s.snag_photos ?? []).map(async (p: any) => {
        if (photoUrlMap.has(p.id)) return
        const { data } = await supabase.storage
          .from('snag-photos')
          .createSignedUrl(p.file_path, 3600)
        photoUrlMap.set(p.id, data?.signedUrl)
      }),
    ),
  )

  // Attach resolved URLs back onto photos in-place.
  for (const s of allBucketSnags) {
    for (const p of s.snag_photos ?? []) {
      p.url = photoUrlMap.get(p.id)
    }
  }

  // ── Resolve names via service client ──
  // Collect all user IDs referenced on this page (conducted_by + attendees are
  // names already; assignedTo on snags is a UUID we need to resolve).
  const conductedById: string | null = (visit as any).conducted_by ?? null
  const snagUserIds = allBucketSnags
    .flatMap((s: any) => [s.assigned_to, s.raised_by].filter(Boolean))
  const profileIds = [...new Set([conductedById, ...snagUserIds].filter(Boolean) as string[])]

  const profileMap = new Map<string, string | null>()
  if (profileIds.length > 0) {
    const { data: profiles } = await serviceClient
      .from('profiles')
      .select('id, full_name, email')
      .in('id', profileIds)
    for (const p of profiles ?? []) {
      const label = p.full_name ?? p.email ?? null
      profileMap.set(p.id, label)
    }
  }

  // ── Build the member list for VisitForm (edit mode) + AddSnagForm ──
  // All project members visible to the service client.
  const memberRows: Array<{ user_id: string; full_name: string | null; email: string | null }> = []
  {
    const { data: pmRows } = await (supabase as any)
      .schema('projects')
      .from('project_members')
      .select('user_id')
      .eq('project_id', projectId)
      .eq('is_active', true)

    const userIds: string[] = (pmRows ?? []).map((r: any) => r.user_id as string)
    if (currentUserId && !userIds.includes(currentUserId)) userIds.push(currentUserId)

    if (userIds.length > 0) {
      const { data: profileRows } = await serviceClient
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds)
      for (const p of profileRows ?? []) {
        memberRows.push({ user_id: p.id, full_name: p.full_name, email: p.email })
        if (!profileMap.has(p.id)) {
          profileMap.set(p.id, p.full_name ?? p.email ?? null)
        }
      }
    }
  }

  // Attach resolved names to bucket snags.
  for (const s of allBucketSnags) {
    s._assignedToName = s.assigned_to ? (profileMap.get(s.assigned_to) ?? null) : null
    s._raisedByName = s.raised_by ? (profileMap.get(s.raised_by) ?? null) : null
  }

  // ── visit_no of the origin visit for each still-open snag ──
  const visitNoById = new Map(allVisits.map(v => [v.id, v.visit_no]))

  const conductedByName = conductedById ? (profileMap.get(conductedById) ?? null) : null

  return (
    <div className="animate-fadeup" style={{ maxWidth: 900 }}>
      {/* Breadcrumb */}
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--c-text-dim)',
        }}
      >
        <Link
          href={`/projects/${projectId}`}
          style={{ color: 'var(--c-text-dim)', textDecoration: 'none' }}
        >
          {(project as any).name}
        </Link>
        <span>/</span>
        <Link
          href={`/projects/${projectId}/snags`}
          style={{ color: 'var(--c-text-dim)', textDecoration: 'none' }}
        >
          Snags
        </Link>
        <span>/</span>
        <span style={{ color: 'var(--c-text-mid)' }}>
          {(visit as any).is_backlog
            ? 'Initial backlog'
            : `Site Visit ${(visit as any).visit_no}`}
        </span>
      </div>

      <VisitDetail
        projectId={projectId}
        visit={visit as any}
        conductedByName={conductedByName}
        newSnags={buckets.newSnags as any[]}
        stillOpen={buckets.stillOpen as any[]}
        closedThisVisit={buckets.closedThisVisit as any[]}
        visitNoById={Object.fromEntries(visitNoById)}
        members={memberRows}
        currentUserId={currentUserId}
      />
    </div>
  )
}
