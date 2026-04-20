import type { TypedSupabaseClient } from '@esite/db'
import type { CreateOrgInput, InviteMemberInput } from '../schemas/org.schema'
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

  async invite(client: TypedSupabaseClient, orgId: string, invitedBy: string, input: InviteMemberInput) {
    // Upsert — resend if already invited
    const { data, error } = await client
      .from('org_invites')
      .upsert(
        {
          organisation_id: orgId,
          email: input.email,
          role: input.role,
          invited_by: invitedBy,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          accepted_at: null,
        },
        { onConflict: 'organisation_id,email', ignoreDuplicates: false }
      )
      .select()
      .single()
    if (error) throw error
    return data
  },

  async getPendingInvites(client: TypedSupabaseClient, orgId: string) {
    const { data, error } = await client
      .from('org_invites')
      .select('*, invited_by_profile:profiles!invited_by(full_name)')
      .eq('organisation_id', orgId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  },

  async getInviteByToken(client: TypedSupabaseClient, token: string) {
    const { data, error } = await client
      .from('org_invites')
      .select('*, organisation:organisations(id, name, logo_url)')
      .eq('token', token)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .single()
    if (error) throw error
    return data
  },

  async acceptInvite(client: TypedSupabaseClient, token: string, userId: string) {
    const invite = await this.getInviteByToken(client, token)

    // Add to org
    const { error: memberErr } = await client
      .from('user_organisations')
      .upsert(
        {
          user_id: userId,
          organisation_id: invite.organisation_id,
          role: invite.role,
          is_active: true,
          accepted_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,organisation_id' }
      )
    if (memberErr) throw memberErr

    // Mark invite accepted
    await client
      .from('org_invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('token', token)

    return invite
  },

  async removeMember(client: TypedSupabaseClient, orgId: string, userId: string) {
    const { error } = await client
      .from('user_organisations')
      .update({ is_active: false })
      .eq('organisation_id', orgId)
      .eq('user_id', userId)
    if (error) throw error
  },

  async revokeInvite(client: TypedSupabaseClient, inviteId: string) {
    const { error } = await client.from('org_invites').delete().eq('id', inviteId)
    if (error) throw error
  },
}
