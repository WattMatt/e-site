/**
 * Edge Function: generate-report
 *
 * Generates a PDF-like HTML report for a project's snag list or site compliance.
 * Returns HTML that can be printed/saved as PDF by the browser via window.print().
 *
 * Request body:
 *   { type: 'snag-list' | 'compliance', entityId: string }
 *   Authorization: Bearer <access_token>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  try {
    const { type, entityId } = await req.json() as { type: 'snag-list' | 'compliance'; entityId: string }

    if (type === 'snag-list') {
      const { data: snags, error } = await supabase
        .schema('field')
        .from('snags')
        .select(`
          id, title, description, location, priority, status, category, created_at, resolved_at,
          raised_by_profile:profiles!raised_by(full_name),
          assigned_to_profile:profiles!assigned_to(full_name)
        `)
        .eq('project_id', entityId)
        .order('created_at', { ascending: false })

      if (error) throw error

      const { data: project } = await supabase
        .schema('projects')
        .from('projects')
        .select('name, address, city, province')
        .eq('id', entityId)
        .single()

      const html = generateSnagReport(project as any, snags ?? [])
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    if (type === 'compliance') {
      const { data: site, error } = await supabase
        .schema('compliance')
        .from('sites')
        .select(`
          name, address, city, province,
          subsections(id, name, sans_ref, coc_status, sort_order,
            coc_uploads(version, status, created_at)
          )
        `)
        .eq('id', entityId)
        .single()

      if (error) throw error

      const html = generateComplianceReport(site as any)
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    return new Response(JSON.stringify({ error: 'Invalid report type' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('generate-report error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

const BASE_STYLES = `
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    body { background: #fff; color: #111; padding: 32px; font-size: 13px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    h2 { font-size: 16px; font-weight: 700; margin: 24px 0 12px; color: #334155; border-bottom: 2px solid #E2E8F0; padding-bottom: 6px; }
    .meta { color: #64748B; font-size: 12px; margin-bottom: 24px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { background: #F1F5F9; text-align: left; padding: 8px 12px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #E2E8F0; }
    td { padding: 8px 12px; border-bottom: 1px solid #F1F5F9; vertical-align: top; }
    tr:hover td { background: #F8FAFC; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #E2E8F0; color: #94A3B8; font-size: 11px; display: flex; justify-content: space-between; }
    @media print { body { padding: 16px; } .no-print { display: none !important; } }
    .priority-critical { background: #FEE2E2; color: #991B1B; }
    .priority-high { background: #FFEDD5; color: #9A3412; }
    .priority-medium { background: #FEF9C3; color: #854D0E; }
    .priority-low { background: #F1F5F9; color: #475569; }
    .status-open { background: #FEE2E2; color: #991B1B; }
    .status-in_progress { background: #FFEDD5; color: #9A3412; }
    .status-resolved { background: #DBEAFE; color: #1E40AF; }
    .status-pending_sign_off { background: #FEF9C3; color: #854D0E; }
    .status-signed_off { background: #DCFCE7; color: #166534; }
    .status-closed { background: #F1F5F9; color: #475569; }
    .coc-approved { background: #DCFCE7; color: #166534; }
    .coc-submitted { background: #DBEAFE; color: #1E40AF; }
    .coc-under_review { background: #FEF9C3; color: #854D0E; }
    .coc-rejected { background: #FEE2E2; color: #991B1B; }
    .coc-missing { background: #F1F5F9; color: #475569; }
  </style>
`

function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

function generateSnagReport(project: any, snags: any[]): string {
  const open = snags.filter(s => ['open', 'in_progress'].includes(s.status)).length
  const closed = snags.filter(s => ['signed_off', 'closed'].includes(s.status)).length

  const rows = snags.map(s => `
    <tr>
      <td>${s.title}<br><small style="color:#64748B">${s.location ?? ''}</small></td>
      <td><span class="badge priority-${s.priority}">${s.priority}</span></td>
      <td><span class="badge status-${s.status}">${s.status.replace(/_/g, ' ')}</span></td>
      <td>${s.category ?? '–'}</td>
      <td>${(s.raised_by_profile as any)?.full_name ?? '–'}</td>
      <td>${(s.assigned_to_profile as any)?.full_name ?? '–'}</td>
      <td>${fmt(s.created_at)}</td>
      <td>${s.resolved_at ? fmt(s.resolved_at) : '–'}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html><html><head><title>Snag Report — ${project?.name ?? ''}</title>${BASE_STYLES}</head><body>
    <button class="no-print" onclick="window.print()" style="float:right;padding:8px 16px;background:#2563EB;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">Print / Save PDF</button>
    <div style="margin-bottom:4px"><strong>E-Site</strong> <span style="color:#94A3B8;font-size:11px">Snag Report</span></div>
    <h1>${project?.name ?? 'Project'} — Snag List</h1>
    <p class="meta">${project?.city ?? ''}${project?.province ? `, ${project.province}` : ''} · Generated ${fmt(new Date().toISOString())} · ${snags.length} snags (${open} open, ${closed} closed)</p>
    <table>
      <thead><tr>
        <th>Title / Location</th><th>Priority</th><th>Status</th><th>Category</th>
        <th>Raised by</th><th>Assigned to</th><th>Created</th><th>Resolved</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer"><span>E-Site Construction Management</span><span>Confidential</span></div>
  </body></html>`
}

function generateComplianceReport(site: any): string {
  const subs = (site.subsections ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order)
  const approved = subs.filter((s: any) => s.coc_status === 'approved').length
  const total = subs.length
  const score = total === 0 ? 0 : Math.round((approved / total) * 100)

  const rows = subs.map((s: any) => {
    const uploads = s.coc_uploads ?? []
    const latest = uploads[uploads.length - 1]
    return `
      <tr>
        <td>${s.name}<br><small style="color:#64748B">${s.sans_ref ?? ''}</small></td>
        <td><span class="badge coc-${s.coc_status}">${s.coc_status.replace(/_/g, ' ')}</span></td>
        <td>${uploads.length > 0 ? `v${latest.version}` : '–'}</td>
        <td>${latest ? fmt(latest.created_at) : '–'}</td>
      </tr>
    `
  }).join('')

  return `<!DOCTYPE html><html><head><title>COC Report — ${site.name}</title>${BASE_STYLES}</head><body>
    <button class="no-print" onclick="window.print()" style="float:right;padding:8px 16px;background:#2563EB;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">Print / Save PDF</button>
    <div style="margin-bottom:4px"><strong>E-Site</strong> <span style="color:#94A3B8;font-size:11px">COC Compliance Report</span></div>
    <h1>${site.name}</h1>
    <p class="meta">${site.address}${site.city ? `, ${site.city}` : ''} · Generated ${fmt(new Date().toISOString())} · Compliance score: <strong>${score}%</strong> (${approved}/${total} approved)</p>
    <table>
      <thead><tr><th>Subsection / SANS Ref</th><th>Status</th><th>Version</th><th>Last Updated</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer"><span>E-Site Construction Management</span><span>Confidential — for regulatory use</span></div>
  </body></html>`
}
