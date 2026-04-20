import type { TypedSupabaseClient } from '@esite/db'
import { fetchProfileMap } from './_utils'

export const complianceService = {
  async listSites(client: TypedSupabaseClient, orgId: string) {
    const { data, error } = await client
      .schema('compliance')
      .from('sites')
      .select(`
        *,
        subsections(id, name, coc_status)
      `)
      .eq('organisation_id', orgId)
      .eq('status', 'active')
      .order('name')
    if (error) throw error
    return data
  },

  async getSite(client: TypedSupabaseClient, siteId: string) {
    const { data, error } = await client
      .schema('compliance')
      .from('sites')
      .select(`
        *,
        subsections(
          id, name, description, sans_ref, coc_status, sort_order,
          coc_uploads(id, status, file_path, version, created_at, uploaded_by)
        )
      `)
      .eq('id', siteId)
      .single()
    if (error) throw error
    const site = data as any
    const uploaderIds = (site.subsections ?? []).flatMap((sub: any) =>
      (sub.coc_uploads ?? []).map((u: any) => u.uploaded_by)
    )
    const profiles = await fetchProfileMap(client, uploaderIds)
    return {
      ...site,
      subsections: (site.subsections ?? []).map((sub: any) => ({
        ...sub,
        coc_uploads: (sub.coc_uploads ?? []).map((u: any) => ({
          ...u,
          uploaded_by_profile: u.uploaded_by ? (profiles[u.uploaded_by] ?? null) : null,
        })),
      })),
    }
  },

  async createSite(client: TypedSupabaseClient, orgId: string, userId: string, input: {
    name: string
    address: string
    city?: string
    province?: string
    erfNumber?: string
    siteType?: string
  }) {
    const { data, error } = await client
      .schema('compliance')
      .from('sites')
      .insert({
        organisation_id: orgId,
        created_by: userId,
        name: input.name,
        address: input.address,
        city: input.city,
        province: input.province,
        erf_number: input.erfNumber,
        site_type: input.siteType ?? 'residential',
      })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async createSubsection(client: TypedSupabaseClient, siteId: string, orgId: string, input: {
    name: string
    description?: string
    sansRef?: string
    sortOrder?: number
  }) {
    const { data, error } = await client
      .schema('compliance')
      .from('subsections')
      .insert({
        site_id: siteId,
        organisation_id: orgId,
        name: input.name,
        description: input.description,
        sans_ref: input.sansRef,
        sort_order: input.sortOrder ?? 0,
      })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async uploadCoc(client: TypedSupabaseClient, subsectionId: string, orgId: string, userId: string, filePath: string, fileSizeBytes?: number) {
    // Get current version
    const { count } = await client
      .schema('compliance')
      .from('coc_uploads')
      .select('id', { count: 'exact', head: true })
      .eq('subsection_id', subsectionId)

    const { data, error } = await client
      .schema('compliance')
      .from('coc_uploads')
      .insert({
        subsection_id: subsectionId,
        organisation_id: orgId,
        uploaded_by: userId,
        file_path: filePath,
        file_size_bytes: fileSizeBytes,
        version: (count ?? 0) + 1,
        status: 'submitted',
      })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async getSiteComplianceScore(client: TypedSupabaseClient, siteId: string) {
    const { data, error } = await client
      .schema('compliance')
      .from('subsections')
      .select('coc_status')
      .eq('site_id', siteId)
    if (error) throw error

    const total = data?.length ?? 0
    if (total === 0) return { score: 0, total: 0, approved: 0, pending: 0, missing: 0 }

    const counts = (data ?? []).reduce(
      (acc, s) => {
        if (s.coc_status === 'approved') acc.approved++
        else if (s.coc_status === 'submitted' || s.coc_status === 'under_review') acc.pending++
        else acc.missing++
        return acc
      },
      { approved: 0, pending: 0, missing: 0 }
    )
    return { ...counts, total, score: Math.round((counts.approved / total) * 100) }
  },
}
