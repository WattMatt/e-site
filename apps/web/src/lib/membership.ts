export type MembershipState = 'pending' | 'active' | 'deactivated'

/** Classify a user_organisations row. accepted_at IS NULL == pending invite. */
export function membershipState(row: { is_active: boolean; accepted_at: string | null }): MembershipState {
  if (row.accepted_at == null) return 'pending'
  return row.is_active ? 'active' : 'deactivated'
}
