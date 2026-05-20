import type { TypedSupabaseClient } from '@esite/db'
import type { CreateOrgInput } from '../schemas/org.schema'
import { slugify } from '../utils/format'

export const orgService = {
  async create(client: TypedSupabaseClient, userId: string, input: CreateOrgInput) {
    // Generate unique slug
    const baseSlug = slugify(input.name)
    const slug = `${baseSlug}-${Date.now().toString(36)}`

    const { data: org, error: orgErr } = await client
      .from('organisations')
      .insert({
        name: input.name,
        slug,
        province: input.province,
        registration_no: input.registrationNo,
      })
      .select()
      .single()
    if (orgErr) throw orgErr

    // Add creator as owner
    const { error: memberErr } = await client
      .from('user_organisations')
      .insert({
        user_id: userId,
        organisation_id: org.id,
        role: 'owner',
        is_active: true,
        accepted_at: new Date().toISOString(),
      })
    if (memberErr) throw memberErr

    return org
  },

  async getByUser(client: TypedSupabaseClient, userId: string) {
    const { data, error } = await client
      .from('user_organisations')
      .select('organisation_id, role, is_active, organisation:organisations(*)')
      .eq('user_id', userId)
      .eq('is_active', true)
    if (error) throw error
    return data
  },

  async getMembers(client: TypedSupabaseClient, orgId: string) {
    const { data, error } = await client
      .from('user_organisations')
      .select(`
        id, role, is_active, created_at,
        profile:profiles!user_organisations_user_id_fkey(id, full_name, email, avatar_url)
      `)
      .eq('organisation_id', orgId)
      .eq('is_active', true)
      .order('created_at')
    if (error) throw error
    return data
  },

  async removeMember(client: TypedSupabaseClient, orgId: string, userId: string) {
    const { error } = await client
      .from('user_organisations')
      .update({ is_active: false })
      .eq('organisation_id', orgId)
      .eq('user_id', userId)
    if (error) throw error
  },
}
