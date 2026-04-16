/**
 * Edge Function: compliance-complete
 *
 * Triggered when a PM approves the last subsection for a site.
 * Checks if ALL subsections are now approved, then:
 *   1. Creates a "Compliance Complete" notification for the org
 *   2. Generates a compliance summary payload (used by web to render PDF)
 *   3. Optionally sends push + email notification to org admin
 *
 * Can also be called directly to generate a certificate pack for any site
 * regardless of completion state (for partial reports).
 *
 * Request body:
 *   { siteId: string }
 *   Authorization: Bearer <service_role_key> or user JWT
 *
 * Response:
 *   {
 *     complete: boolean
 *     score: number
 *     siteName: string
 *     subsections: Array<SubsectionStatus>
 *     generatedAt: string
 *   }
 *
 * Spec § 7.2 T-027
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface SubsectionStatus {
  id: string
  name: string
  sansRef: string | null
  cocStatus: string
  latestUploadVersion: number | null
  latestUploadDate: string | null
  reviewerName: string | null
  reviewedAt: string | null
}

interface CertificatePack {
  complete: boolean
  score: number
  totalSubsections: number
  approvedSubsections: number
  siteName: string
  siteAddress: string
  organisationId: string
  siteId: string
  subsections: SubsectionStatus[]
  generatedAt: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { siteId: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!body.siteId) {
    return new Response(JSON.stringify({ error: 'siteId is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Use service role for read (triggered by review action, needs cross-table access)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    // 1. Load site with all subsections and latest COC upload per subsection
    const { data: site, error: siteErr } = await supabase
      .schema('compliance')
      .from('sites')
      .select(`
        id, name, address, city, province, organisation_id,
        subsections(
          id, name, sans_ref, coc_status, sort_order,
          coc_uploads(
            id, version, status, reviewed_at, file_path,
            reviewer:profiles!reviewer_id(full_name)
          )
        )
      `)
      .eq('id', body.siteId)
      .single()

    if (siteErr || !site) {
      return new Response(JSON.stringify({ error: 'Site not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      })
    }

    const subsections = (site.subsections as any[]).sort((a, b) => a.sort_order - b.sort_order)
    const total = subsections.length
    const approved = subsections.filter((s: any) => s.coc_status === 'approved').length
    const complete = total > 0 && approved === total
    const score = total > 0 ? Math.round((approved / total) * 100) : 0

    const subsectionStatuses: SubsectionStatus[] = subsections.map((sub: any) => {
      const uploads = (sub.coc_uploads as any[]).sort((a: any, b: any) => b.version - a.version)
      const latest = uploads[0] ?? null

      return {
        id: sub.id,
        name: sub.name,
        sansRef: sub.sans_ref ?? null,
        cocStatus: sub.coc_status ?? 'missing',
        latestUploadVersion: latest?.version ?? null,
        latestUploadDate: latest?.created_at ?? null,
        reviewerName: latest?.reviewer?.full_name ?? null,
        reviewedAt: latest?.reviewed_at ?? null,
      }
    })

    const pack: CertificatePack = {
      complete,
      score,
      totalSubsections: total,
      approvedSubsections: approved,
      siteName: site.name,
      siteAddress: [site.address, (site as any).city, (site as any).province]
        .filter(Boolean)
        .join(', '),
      organisationId: site.organisation_id,
      siteId: body.siteId,
      subsections: subsectionStatuses,
      generatedAt: new Date().toISOString(),
    }

    // 2. If all subsections are now approved, fire completion notification
    if (complete) {
      console.log(`Site ${body.siteId} compliance COMPLETE — all ${total} subsections approved`)

      // Get org admin/owner user IDs for notification
      const { data: admins } = await supabase
        .from('user_organisations')
        .select('user_id')
        .eq('organisation_id', site.organisation_id)
        .in('role', ['owner', 'admin', 'project_manager'])
        .eq('is_active', true)

      if (admins?.length) {
        const userIds = admins.map((a: any) => a.user_id)

        // Insert in-app notification records
        const notifications = userIds.map((userId: string) => ({
          user_id: userId,
          organisation_id: site.organisation_id,
          type: 'compliance_complete',
          title: 'Compliance Complete',
          body: `${site.name} is now 100% compliant. All ${total} COCs approved.`,
          metadata: { site_id: body.siteId, score: 100 },
          is_read: false,
        }))

        await supabase
          .from('notifications')
          .insert(notifications)
          .then(({ error }) => {
            if (error) console.error('Failed to insert notifications:', error.message)
          })

        // Send push notifications (best-effort)
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({
            userIds,
            title: '✓ Compliance Complete',
            body: `${site.name} — all ${total} COCs approved`,
            data: { route: `/compliance/${body.siteId}` },
          }),
        }).catch((err: Error) => console.error('Push notification failed:', err.message))
      }
    }

    return new Response(JSON.stringify(pack), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('compliance-complete error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
