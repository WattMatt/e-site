import type { TypedSupabaseClient } from '@esite/db'

export const authService = {
  async signIn(client: TypedSupabaseClient, email: string, password: string) {
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  },

  async signUp(client: TypedSupabaseClient, email: string, password: string, fullName: string) {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    if (error) throw error
    return data
  },

  async signOut(client: TypedSupabaseClient) {
    const { error } = await client.auth.signOut()
    if (error) throw error
  },

  async getSession(client: TypedSupabaseClient) {
    const { data, error } = await client.auth.getSession()
    if (error) throw error
    return data.session
  },

  async getProfile(client: TypedSupabaseClient, userId: string) {
    const { data, error } = await client
      .from('profiles')
      .select('*, user_organisations(organisation_id, role, is_active)')
      .eq('id', userId)
      .single()
    if (error) throw error
    return data
  },

  async resetPassword(client: TypedSupabaseClient, email: string, redirectTo: string) {
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) throw error
  },

  async updatePassword(client: TypedSupabaseClient, newPassword: string) {
    const { error } = await client.auth.updateUser({ password: newPassword })
    if (error) throw error
  },
}
